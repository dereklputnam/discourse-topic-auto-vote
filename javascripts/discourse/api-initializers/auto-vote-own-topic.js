import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";

export default apiInitializer("1.0", (api) => {
  // Always log during debug - force it on for now
  const DEBUG = true;

  const log = (...args) => {
    if (DEBUG || settings.auto_vote_debug_mode) {
      console.log("[Auto Vote Own Topic]", ...args);
    }
  };

  log("=== INITIALIZING AUTO VOTE COMPONENT ===");
  log("Settings:", {
    enabled: settings.auto_vote_enabled,
    categories: settings.auto_vote_categories,
    debug: settings.auto_vote_debug_mode,
  });

  const currentUser = api.getCurrentUser();
  log("Current user:", currentUser ? { id: currentUser.id, username: currentUser.username } : "NOT LOGGED IN");

  // Exit early if user is not logged in
  if (!currentUser) {
    log("Exiting - no user logged in");
    return;
  }

  // Track topics we've already attempted to auto-vote on this session
  const autoVotedTopics = new Set();

  const isCategoryAllowed = (categoryId) => {
    // If no categories specified, allow all
    if (!settings.auto_vote_categories || settings.auto_vote_categories.length === 0) {
      log("No category restrictions - allowing all");
      return true;
    }

    // Parse the pipe-separated list of category IDs
    const allowedIds = settings.auto_vote_categories
      .split("|")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));

    if (allowedIds.length === 0) {
      log("No valid category IDs parsed - allowing all");
      return true;
    }

    const allowed = allowedIds.includes(categoryId);
    log("Category check:", { categoryId, allowedIds, allowed });
    return allowed;
  };

  const castVote = async (topicId, source) => {
    log(`castVote called from ${source} for topic:`, topicId);

    // Prevent duplicate attempts
    if (autoVotedTopics.has(topicId)) {
      log("Already attempted auto-vote for topic:", topicId);
      return false;
    }

    autoVotedTopics.add(topicId);

    try {
      log("Making API call to /voting/vote with topic_id:", topicId);

      const response = await ajax("/voting/vote", {
        type: "POST",
        data: { topic_id: topicId },
      });

      log("Vote API response:", response);
      log("SUCCESS! Vote cast for topic:", topicId);
      return true;
    } catch (error) {
      log("Vote API error:", {
        status: error.jqXHR?.status,
        statusText: error.jqXHR?.statusText,
        responseText: error.jqXHR?.responseText,
      });
      // 422 usually means already voted or can't vote
      if (error.jqXHR?.status === 422) {
        log("Could not vote (may already be voted or not allowed)");
      } else {
        console.error("[Auto Vote Own Topic] Error casting vote:", error);
      }
      return false;
    }
  };

  const checkAndVote = (topic, source) => {
    log(`checkAndVote called from ${source}`);

    if (!settings.auto_vote_enabled) {
      log("Auto-vote is disabled in settings");
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

    log("Topic data:", {
      topicId,
      userId: topic.user_id,
      currentUserId: currentUser.id,
      canVote: topic.can_vote,
      userVoted: topic.user_voted,
      categoryId: topic.category_id,
    });

    // Check if user created this topic
    if (topic.user_id !== currentUser.id) {
      log("SKIP: User is not the topic creator");
      return;
    }

    // Check if voting is enabled for this topic
    if (!topic.can_vote) {
      log("SKIP: Voting not enabled for this topic (can_vote=false)");
      return;
    }

    // Check if user already voted
    if (topic.user_voted) {
      log("SKIP: User has already voted on this topic");
      return;
    }

    // Check if category is allowed
    if (!isCategoryAllowed(topic.category_id)) {
      log("SKIP: Category not in allowed list");
      return;
    }

    log("All checks passed! Casting vote...");
    castVote(topicId, source);
  };

  // ========================================
  // METHOD 1: onPageChange (fallback for refresh)
  // ========================================
  api.onPageChange((url) => {
    log("onPageChange fired:", url);

    const topicMatch = url.match(/\/t\/[^/]+\/(\d+)/);
    if (!topicMatch) {
      return;
    }

    log("On topic page, topic ID from URL:", topicMatch[1]);

    setTimeout(() => {
      const topicController = api.container.lookup("controller:topic");
      const topic = topicController?.model;
      log("Topic controller model:", topic ? "found" : "NOT FOUND");

      if (topic) {
        checkAndVote(topic, "onPageChange");
      }
    }, 500);
  });

  // ========================================
  // METHOD 2: Listen for various app events
  // ========================================
  const eventsToWatch = [
    "composer:created-post",
    "composer:saved",
    "composer:closed",
    "topic:created",
    "post:created",
    "page:topic-loaded",
  ];

  eventsToWatch.forEach((eventName) => {
    api.onAppEvent(eventName, (data) => {
      log(`AppEvent "${eventName}" fired:`, data);

      // If this looks like it has topic info, try to vote
      if (data?.topic_id || data?.id) {
        const topicId = data.topic_id || data.id;
        log(`Event has topic ID: ${topicId}, attempting vote...`);

        // For events, we might not have full topic data, so just try to vote
        if (settings.auto_vote_enabled) {
          castVote(topicId, `appEvent:${eventName}`);
        }
      }
    });
  });

  // ========================================
  // METHOD 3: Modify composer model
  // ========================================
  log("Setting up composer model modification...");

  api.modifyClass("model:composer", {
    pluginId: "auto-vote-own-topic",

    afterSave(result) {
      log("=== COMPOSER afterSave CALLED ===");
      log("this.creatingTopic:", this.creatingTopic);
      log("result:", result);
      log("result?.responseJson:", result?.responseJson);
      log("result?.responseJson?.post:", result?.responseJson?.post);

      this._super(...arguments);

      if (this.creatingTopic) {
        log("This IS a new topic creation");

        const topicId = result?.responseJson?.post?.topic_id;
        const categoryId = this.categoryId;

        log("Extracted data:", { topicId, categoryId });

        if (!topicId) {
          log("ERROR: Could not extract topic_id from result");
          return;
        }

        if (!settings.auto_vote_enabled) {
          log("Auto-vote is disabled");
          return;
        }

        if (!isCategoryAllowed(categoryId)) {
          log("Category not allowed");
          return;
        }

        log("Calling castVote from composer afterSave...");
        castVote(topicId, "composer:afterSave");
      } else {
        log("This is NOT a new topic (probably a reply)");
      }
    },
  });

  // ========================================
  // METHOD 4: Intercept AJAX responses
  // ========================================
  log("Setting up AJAX interceptor...");

  const originalAjax = $.ajax;
  $.ajax = function (options) {
    const result = originalAjax.apply(this, arguments);

    if (result && result.then) {
      result.then((response, textStatus, jqXHR) => {
        const url = options.url || "";

        // Check if this is a topic creation POST
        if (options.type === "POST" && url.includes("/posts")) {
          log("=== AJAX POST to /posts detected ===");
          log("Response:", response);

          if (response?.post?.topic_id && response?.post?.post_number === 1) {
            const topicId = response.post.topic_id;
            log("New topic detected from AJAX! Topic ID:", topicId);

            if (settings.auto_vote_enabled) {
              // Small delay to ensure topic is fully created
              setTimeout(() => {
                castVote(topicId, "ajax:interceptor");
              }, 100);
            }
          }
        }
      });
    }

    return result;
  };

  log("=== AUTO VOTE COMPONENT FULLY INITIALIZED ===");
});
