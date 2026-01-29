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

    log("Category settings value:", settings.auto_vote_categories);
    log("Parsed category settings:", categorySettings);
    log("Checking category ID:", categoryId);

    // First try: direct numeric ID match
    const numericIds = categorySettings.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
    if (numericIds.length > 0 && numericIds.includes(categoryId)) {
      log("Category matched by numeric ID");
      return true;
    }

    // Second try: look up category by ID and match by slug
    const site = api.container.lookup("service:site");
    if (site && site.categories) {
      const category = site.categories.find((c) => c.id === categoryId);
      if (category) {
        log("Found category:", { id: category.id, slug: category.slug, name: category.name });

        // Check if the category slug or name matches any setting
        const lowerSettings = categorySettings.map((s) => s.toLowerCase());
        if (lowerSettings.includes(category.slug?.toLowerCase()) ||
            lowerSettings.includes(category.name?.toLowerCase())) {
          log("Category matched by slug/name");
          return true;
        }

        // Also check parent category path (e.g., "products/1secure/ideas")
        if (category.slug) {
          const fullSlug = category.parentCategory
            ? `${category.parentCategory.slug}/${category.slug}`
            : category.slug;
          if (lowerSettings.includes(fullSlug.toLowerCase())) {
            log("Category matched by full slug path");
            return true;
          }
        }
      }
    }

    log("Category not matched:", categoryId);
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

  // Method 1: Listen for topic:created event
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

  // Method 2: Intercept AJAX to catch new topic creation
  const originalAjax = $.ajax;
  $.ajax = function (options) {
    const result = originalAjax.apply(this, arguments);

    // Only intercept if it returns a promise
    if (result && result.then) {
      result.then((response) => {
        const url = options.url || "";

        // Check if this is a topic creation POST
        if (options.type === "POST" && url.includes("/posts")) {
          // New topic = post_number 1
          if (response?.post?.topic_id && response?.post?.post_number === 1) {
            const topicId = response.post.topic_id;
            const categoryId = response.post.category_id;

            log("New topic detected from AJAX:", { topicId, categoryId });

            if (isCategoryAllowed(categoryId)) {
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

  // Method 3: Fallback on page navigation
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
