export function createVoteEventsRoutesHandler(deps) {
  const {
    getDashboardRequestTranslator,
    getVoteEventsState,
    isAdminApiRequest,
    languagePick,
    methodNotAllowed,
    sendJson,
  } = deps;

  function buildRewardReadiness(voteState) {
    const providers = voteState?.providers || {};
    return {
      unifiedStore: true,
      idempotentEvents: true,
      rewardEngineImplemented: false,
      rewardEngineReady: true,
      supportedVoteProviders: Object.keys(providers).filter((provider) => providers[provider]),
      unsupportedVoteProviders: ["botsgg"],
      note: "discord.bots.gg is excluded from unified vote rewards because its documented public API does not expose vote webhooks or vote history endpoints.",
    };
  }

  return async function handleVoteEventsRoutes(context) {
    const { req, res, requestUrl } = context;
    if (requestUrl.pathname !== "/api/vote-events/status") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }
    if (!isAdminApiRequest(req)) {
      sendJson(res, 401, {
        error: languagePick(language, "Nicht autorisiert. API-Admin-Token erforderlich.", "Unauthorized. API admin token required."),
      });
      return true;
    }

    const limit = Number.parseInt(String(requestUrl.searchParams.get("limit") || "50"), 10);
    const provider = String(requestUrl.searchParams.get("provider") || "").trim().toLowerCase();
    const userId = String(requestUrl.searchParams.get("userId") || "").trim();
    const voteState = getVoteEventsState({
      limit: Math.max(0, Number.isFinite(limit) ? limit : 50),
      provider,
    });
    const filteredVotes = userId
      ? voteState.votes.filter((vote) => String(vote?.userId || "").trim() === userId)
      : voteState.votes;

    sendJson(res, 200, {
      totalVotes: voteState.totalVotes,
      provider: provider || null,
      userId: userId || null,
      providers: voteState.providers,
      votes: filteredVotes,
      rewardReadiness: buildRewardReadiness(voteState),
    });
    return true;
  };
}
