// Auto Vote Own Topic v1.4 - with direct DOM manipulation for instant UI
import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.0", (api) => {
  const currentUser = api.getCurrentUser();

  if (!currentUser) {
    return;
  }

  const log = (...args) => {
    if (settings.auto_vote_debug_mode) {
      console.log("[Auto Vote Own Topic]", ...args);
    }
  };

  log("Initializing auto-vote component for user:", currentUser.username);

  // Function to update the vote UI via DOM manipulation
  const updateVoteUI = (voteCount) => {
    log("Updating vote UI via DOM manipulation");

    // Update vote count display
    const voteCountEl = document.querySelector(".vote-count-number");
    if (voteCountEl) {
      voteCountEl.textContent = voteCount;
      log("Updated vote count to:", voteCount);
    }

    // Update vote button to show "voted" state
    const voteButton = document.querySelector(".vote-button");
    if (voteButton) {
      // Remove "nonvote" class and add "vote" class
      voteButton.classList.remove("nonvote");
      voteButton.classList.add("vote");
      log("Updated vote button classes");

      // Update button text if it contains vote text
      const buttonSpan = voteButton.querySelector("span");
      if (buttonSpan && buttonSpan.textContent.toLowerCase().includes("vote")) {
        buttonSpan.textContent = "Voted";
      }
    }

    // Also update the wrapper
    const votingWrapper = document.querySelector(".voting-wrapper");
    if (votingWrapper) {
      votingWrapper.classList.remove("nonvote");
      votingWrapper.classList.add("vote");
    }
  };

  const autoVotedTopics = new Set();

  const isCategoryAllowed = (categoryId) => {
    if (!settings.auto_vote_categories || settings.auto_vote_categories.length === 0) {
      log("No category restriction configured, allowing all categories");
      return true;
    }

    const categorySettings = settings.auto_vote_categories.split("|").map((s) => s.trim()).filter(Boolean);

    if (categorySettings.length === 0) {
      log("Empty category list after parsing, allowing all categories");
      return true;
    }

    // First try: direct numeric ID match
    const numericIds = categorySettings.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
    if (numericIds.length > 0 && numericIds.includes(categoryId)) {
      return true;
    }

    // Second try: look up category by ID and match by slug
    const site = api.container.lookup("service:site");
    if (site && site.categories) {
      const category = site.categories.find((c) => c.id === categoryId);
      if (category) {
        // Check if the category slug or name matches any setting
        const lowerSettings = categorySettings.map((s) => s.toLowerCase());
        if (lowerSettings.includes(category.slug?.toLowerCase()) ||
            lowerSettings.includes(category.name?.toLowerCase())) {
          return true;
        }

        // Also check parent category path (e.g., "products/1secure/ideas")
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

  const castVote = async (topicId, source) => {
    if (!settings.auto_vote_enabled) {
      log("Auto-vote is disabled");
      return false;
    }

    if (autoVotedTopics.has(topicId)) {
      log("Already attempted auto-vote for topic:", topicId);
      return false;
    }

    autoVotedTopics.add(topicId);

    try {
      log(`Casting vote for topic ${topicId} (source: ${source})`);

      const response = await ajax("/voting/vote", {
        type: "POST",
        data: { topic_id: topicId },
      });

      log("Vote cast successfully for topic:", topicId, response);

      // Update the UI using multiple approaches for reliability
      try {
        const topicController = api.container.lookup("controller:topic");
        const topic = topicController?.model;

        // Get the new vote count from the response, or calculate it
        const newVoteCount = response.vote_count ?? (topic?.vote_count || 0) + 1;

        if (topic && topic.id === topicId) {
          // Update topic model using direct assignment (like the voting plugin does)
          topic.vote_count = newVoteCount;
          topic.user_voted = true;
          log("Updated topic model: vote_count =", newVoteCount, "user_voted = true");

          // Update currentUser voting state (like the voting plugin does)
          if (response.can_vote !== undefined) {
            currentUser.votes_exceeded = !response.can_vote;
          }
          if (response.votes_left !== undefined) {
            currentUser.votes_left = response.votes_left;
          }
        }

        // Immediately update DOM for instant visual feedback
        updateVoteUI(newVoteCount);

      } catch (e) {
        log("Error updating UI:", e);
        // Even if model update fails, try DOM update
        updateVoteUI(1);
      }

      return true;
    } catch (error) {
      if (error.jqXHR?.status === 422) {
        log("Could not vote (already voted or voting not enabled):", topicId);
      } else {
        log("Error casting vote:", error.jqXHR?.status || error);
      }
      return false;
    }
  };

  // Auto-vote on page navigation to own topic
  // This reliably catches when the user is redirected to their newly created topic
  api.onPageChange((url) => {
    const topicMatch = url.match(/\/t\/[^/]+\/(\d+)/);
    if (!topicMatch) {
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
        log("Found unvoted own topic on page load:", topic.id);
        castVote(topic.id, "onPageChange");
      }
    }, 500);
  });
});
