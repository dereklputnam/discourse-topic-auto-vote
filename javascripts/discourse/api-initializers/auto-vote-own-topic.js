import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.0", (api) => {
  const currentUser = api.getCurrentUser();

  if (!currentUser) {
    return;
  }

  const autoVotedTopics = new Set();
  const preVotedTopics = new Set();

  const isCategoryAllowed = (categoryId) => {
    if (!settings.auto_vote_categories || settings.auto_vote_categories.length === 0) {
      return true;
    }

    const categorySettings = settings.auto_vote_categories.split("|").map((s) => s.trim()).filter(Boolean);

    if (categorySettings.length === 0) {
      return true;
    }

    const numericIds = categorySettings.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
    if (numericIds.length > 0 && numericIds.includes(categoryId)) {
      return true;
    }

    const site = api.container.lookup("service:site");
    if (site && site.categories) {
      const category = site.categories.find((c) => c.id === categoryId);
      if (category) {
        const lowerSettings = categorySettings.map((s) => s.toLowerCase());
        if (lowerSettings.includes(category.slug?.toLowerCase()) ||
            lowerSettings.includes(category.name?.toLowerCase())) {
          return true;
        }

        if (category.slug) {
          const fullSlug = category.parentCategory
            ? `${category.parentCategory.slug}/${category.slug}`
            : category.slug;
          if (lowerSettings.includes(fullSlug.toLowerCase())) {
            return true;
          }
        }
      }
    }

    return false;
  };

  const updateVoteUI = (voteCount) => {
    const voteCountEl = document.querySelector(".vote-count-number");
    if (voteCountEl) {
      voteCountEl.textContent = voteCount;
    }

    const voteButton = document.querySelector(".vote-button");
    if (voteButton) {
      voteButton.classList.remove("nonvote");
      voteButton.classList.add("vote");

      const buttonSpan = voteButton.querySelector("span");
      if (buttonSpan && buttonSpan.textContent.toLowerCase().includes("vote")) {
        buttonSpan.textContent = "Voted";
      }
    }

    const votingWrapper = document.querySelector(".voting-wrapper");
    if (votingWrapper) {
      votingWrapper.classList.remove("nonvote");
      votingWrapper.classList.add("vote");
    }
  };

  const castVote = async (topicId) => {
    if (!settings.auto_vote_enabled) {
      return false;
    }

    if (autoVotedTopics.has(topicId)) {
      return false;
    }

    autoVotedTopics.add(topicId);

    try {
      const response = await ajax("/voting/vote", {
        type: "POST",
        data: { topic_id: topicId },
      });

      const topicController = api.container.lookup("controller:topic");
      const topic = topicController?.model;
      const newVoteCount = response.vote_count ?? (topic?.vote_count || 0) + 1;

      if (topic && topic.id === topicId) {
        topic.vote_count = newVoteCount;
        topic.user_voted = true;

        if (response.can_vote !== undefined) {
          currentUser.votes_exceeded = !response.can_vote;
        }
        if (response.votes_left !== undefined) {
          currentUser.votes_left = response.votes_left;
        }
      }

      updateVoteUI(newVoteCount);
      return true;
    } catch (error) {
      return false;
    }
  };

  // Vote immediately when a new topic is created via the composer
  api.modifyClass("model:composer", {
    pluginId: "auto-vote-own-topic",

    save(opts) {
      const isNewTopic = this.creatingTopic;
      const categoryId = this.categoryId;
      const savePromise = this._super(opts);

      if (isNewTopic && settings.auto_vote_enabled && isCategoryAllowed(categoryId)) {
        savePromise.then((result) => {
          if (result && result.responseJson && result.responseJson.post) {
            const topicId = result.responseJson.post.topic_id;
            preVotedTopics.add(topicId);

            ajax("/voting/vote", {
              type: "POST",
              data: { topic_id: topicId },
            }).catch(() => {
              preVotedTopics.delete(topicId);
            });
          }
        });
      }

      return savePromise;
    }
  });

  // Handle page navigation - update UI for pre-voted topics or vote on visit if enabled
  api.onPageChange((url) => {
    const topicMatch = url.match(/\/t\/[^/]+\/(\d+)/);
    if (!topicMatch) {
      return;
    }

    const topicIdFromUrl = parseInt(topicMatch[1], 10);

    // If we pre-voted this topic during creation, just update the UI
    if (preVotedTopics.has(topicIdFromUrl)) {
      preVotedTopics.delete(topicIdFromUrl);
      autoVotedTopics.add(topicIdFromUrl);

      setTimeout(() => {
        updateVoteUI(1);
      }, 50);
      return;
    }

    // Only vote on visit if the setting is enabled
    if (!settings.auto_vote_on_visit) {
      return;
    }

    setTimeout(() => {
      const topicController = api.container.lookup("controller:topic");
      const topic = topicController?.model;

      if (!topic) {
        return;
      }

      if (
        topic.user_id === currentUser.id &&
        topic.can_vote &&
        !topic.user_voted &&
        isCategoryAllowed(topic.category_id)
      ) {
        castVote(topic.id);
      }
    }, 500);
  });
});
