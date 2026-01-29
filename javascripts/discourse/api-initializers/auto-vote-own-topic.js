import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.0", (api) => {
  const currentUser = api.getCurrentUser();

  // Exit early if user is not logged in
  if (!currentUser) {
    return;
  }

  // Track topics we've already attempted to auto-vote on this session
  const autoVotedTopics = new Set();

  const log = (...args) => {
    if (settings.auto_vote_debug_mode) {
      console.log("[Auto Vote Own Topic]", ...args);
    }
  };

  const isNewlyCreated = (createdAt) => {
    const created = new Date(createdAt);
    const now = new Date();
    const diffSeconds = (now - created) / 1000;
    return diffSeconds < settings.auto_vote_time_window_seconds;
  };

  const isCategoryAllowed = (categoryId) => {
    // If no categories specified, allow all
    if (!settings.auto_vote_category_ids || settings.auto_vote_category_ids.length === 0) {
      return true;
    }

    // Parse the pipe-separated list of category IDs
    const allowedIds = settings.auto_vote_category_ids
      .split("|")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));

    if (allowedIds.length === 0) {
      return true;
    }

    return allowedIds.includes(categoryId);
  };

  const castVote = async (topicId) => {
    try {
      log("Casting vote for topic:", topicId);

      await ajax("/voting/vote", {
        type: "POST",
        data: { topic_id: topicId },
      });

      log("Vote cast successfully for topic:", topicId);
      return true;
    } catch (error) {
      // 422 usually means already voted or can't vote
      if (error.jqXHR?.status === 422) {
        log("Could not vote (may already be voted or not allowed):", error);
      } else {
        console.error("[Auto Vote Own Topic] Error casting vote:", error);
      }
      return false;
    }
  };

  const checkAndVote = (topic) => {
    if (!settings.auto_vote_enabled) {
      log("Auto-vote is disabled");
      return;
    }

    if (!topic) {
      log("No topic model available");
      return;
    }

    const topicId = topic.id;

    // Prevent duplicate attempts in same session
    if (autoVotedTopics.has(topicId)) {
      log("Already attempted auto-vote for topic:", topicId);
      return;
    }

    log("Checking topic:", {
      topicId,
      userId: topic.user_id,
      currentUserId: currentUser.id,
      canVote: topic.can_vote,
      userVoted: topic.user_voted,
      createdAt: topic.created_at,
      categoryId: topic.category_id,
    });

    // Check if user created this topic
    if (topic.user_id !== currentUser.id) {
      log("User is not the topic creator");
      return;
    }

    // Check if voting is enabled for this topic
    if (!topic.can_vote) {
      log("Voting not enabled for this topic");
      return;
    }

    // Check if user already voted
    if (topic.user_voted) {
      log("User has already voted on this topic");
      return;
    }

    // Check if topic is newly created
    if (!isNewlyCreated(topic.created_at)) {
      log("Topic is not newly created (outside time window)");
      return;
    }

    // Check if category is allowed
    if (!isCategoryAllowed(topic.category_id)) {
      log("Category not in allowed list:", topic.category_id);
      return;
    }

    // Mark as attempted before making the call
    autoVotedTopics.add(topicId);

    // Cast the vote
    castVote(topicId);
  };

  // Method 1: Listen for page changes and check topic
  api.onPageChange((url) => {
    // Check if we're on a topic page
    const topicMatch = url.match(/\/t\/[^/]+\/(\d+)/);
    if (!topicMatch) {
      return;
    }

    // Give the page a moment to load the topic model
    setTimeout(() => {
      const topicController = api.container.lookup("controller:topic");
      const topic = topicController?.model;

      if (topic) {
        checkAndVote(topic);
      }
    }, 500);
  });

  // Method 2: Listen for topic model changes via appEvents
  api.onAppEvent("topic:created", (topic) => {
    log("Topic created event received:", topic?.id);
    if (topic) {
      // Small delay to ensure all properties are populated
      setTimeout(() => checkAndVote(topic), 500);
    }
  });

  // Method 3: Hook into the composer after successful post
  api.modifyClass("model:composer", {
    pluginId: "auto-vote-own-topic",

    afterSave(result) {
      this._super(...arguments);

      // Check if this was a new topic creation (not a reply)
      if (result?.responseJson?.post?.topic_id && this.creatingTopic) {
        const topicId = result.responseJson.post.topic_id;
        log("New topic created via composer:", topicId);

        // Fetch topic data and auto-vote after a delay
        setTimeout(async () => {
          try {
            const topicData = await ajax(`/t/${topicId}.json`);
            if (topicData) {
              checkAndVote(topicData);
            }
          } catch (error) {
            log("Error fetching new topic data:", error);
          }
        }, 1000);
      }
    },
  });
});
