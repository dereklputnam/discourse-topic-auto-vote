import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.0", (api) => {
  const currentUser = api.getCurrentUser();

  // Exit early if user is not logged in
  if (!currentUser) {
    return;
  }

  const log = (...args) => {
    if (settings.auto_vote_debug_mode) {
      console.log("[Auto Vote Own Topic]", ...args);
    }
  };

  log("Initializing auto-vote component for user:", currentUser.username);

  // Track topics we've already attempted to auto-vote on this session
  const autoVotedTopics = new Set();

  const isCategoryAllowed = (categoryId) => {
    if (!settings.auto_vote_categories || settings.auto_vote_categories.length === 0) {
      return true;
    }

    const allowedIds = settings.auto_vote_categories
      .split("|")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));

    if (allowedIds.length === 0) {
      return true;
    }

    return allowedIds.includes(categoryId);
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

      await ajax("/voting/vote", {
        type: "POST",
        data: { topic_id: topicId },
      });

      log("Vote cast successfully for topic:", topicId);
      return true;
    } catch (error) {
      if (error.jqXHR?.status === 422) {
        log("Could not vote (already voted or voting not enabled):", topicId);
      } else {
        console.error("[Auto Vote Own Topic] Error casting vote:", error);
      }
      return false;
    }
  };

  // Primary method: Listen for topic:created event
  // This fires immediately when a new topic is created
  api.onAppEvent("topic:created", (data) => {
    log("topic:created event fired:", data);

    if (data?.id) {
      const topicId = data.id;
      const categoryId = data.category_id;

      log("New topic created:", { topicId, categoryId });

      if (!isCategoryAllowed(categoryId)) {
        log("Category not in allowed list:", categoryId);
        return;
      }

      castVote(topicId, "topic:created");
    }
  });

  // Fallback: Check on page load/navigation for topics user created but hasn't voted on
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

      // Only vote if: user created it, can vote, hasn't voted yet
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
