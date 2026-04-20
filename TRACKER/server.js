const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 3000;
const ROOT = __dirname;
const ACCOUNTS_PATH = path.join(ROOT, "accounts.json");
const PROGRESS_CACHE_PATH = path.join(ROOT, "progress-cache.json");
const API_KEY = process.env.RIOT_API_KEY || "RGAPI-143b5ca2-1305-4e5b-b6cb-325b5d37b0b3";
const FETCH_TIMEOUT_MS = 8000;
const RECENT_MATCH_COUNT = 20;
const SPOTLIGHT_MATCH_COUNT = 5;
const CACHE_RECENT_MATCH_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
let championNameCache = null;
let latestDdragonVersionCache = null;

function regionRoute(platform) {
  if (["LA1", "LA2", "NA1", "BR1", "OC1"].includes(platform)) return "americas";
  if (["EUW1", "EUN1", "TR1", "RU"].includes(platform)) return "europe";
  if (["KR", "JP1"].includes(platform)) return "asia";
  throw new Error("Region no soportada");
}



async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function riotFetch(url) {
  let res;

  try {
    res = await fetchWithTimeout(url, {
      headers: { "X-Riot-Token": API_KEY }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Riot API timeout en ${url}`);
    }

    throw new Error(`Fallo de red con Riot API en ${url}: ${error.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Riot API ${res.status} en ${url}: ${text}`);
  }

  return res.json();
}

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToPlainText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).trim();
}

function extractFirst(text, regex) {
  const match = text.match(regex);
  return match?.[1] || null;
}

function extractOpggRecentCards(html) {
  const championMatches = Array.from(
    html.matchAll(
      /https:\/\/opgg-static\.akamaized\.net\/meta\/images\/lol\/[^"\\]+\/champion\/([^"\\/]+)\.png\\",\\"alt\\":\\"\\"[\s\S]{0,240}?\\"children\\":\\"([^"\\]+)\\"/gi
    )
  )
    .map((match) => ({
      iconName: match[1],
      championName: match[2],
      championIconUrl: `https://opgg-static.akamaized.net/meta/images/lol/16.8.1/champion/${match[1]}.png`
    }))
    .filter((entry, index, list) => list.findIndex((item) => item.championName === entry.championName) === index)
    .slice(0, 5);

  const resultMatches = [];
  const resultMarker = ":[\\\"$\\\",\\\"div\\\",null,{\\\"className\\\":\\\"flex w-full items-center justify-center gap-2\\\"";
  let searchIndex = 0;

  while (resultMatches.length < championMatches.length) {
    const markerIndex = html.indexOf(resultMarker, searchIndex);
    if (markerIndex === -1) {
      break;
    }

    const chunk = html.slice(Math.max(0, markerIndex - 4), markerIndex + 1400);
    searchIndex = markerIndex + resultMarker.length;

    const winsMatch = chunk.match(/children\\":\[\\"(\d+)\\",\\"V\\"\]/) || chunk.match(/children\\":\[(\d+),\\"V\\"\]/);
    const lossesMatch = chunk.match(/children\\":\[(\d+),\\"D\\"\]/) || chunk.match(/children\\":\[\\"(\d+)\\",\\"D\\"\]/);
    const wrMatch = chunk.match(/children\\":\\"(\d+)%\\"/);

    if (!winsMatch || !lossesMatch || !wrMatch) {
      continue;
    }

    resultMatches.push({
      wins: Number.parseInt(winsMatch[1] || "0", 10) || 0,
      losses: Number.parseInt(lossesMatch[1] || "0", 10) || 0,
      wr: Number.parseInt(wrMatch[1] || "0", 10) || 0
    });
  }

  return championMatches
    .map((champion, index) => {
      const result = resultMatches[index];
      if (!result) {
        return null;
      }

      return {
        championName: champion.championName,
        championIconUrl: champion.championIconUrl,
        win: result.wins >= result.losses,
        wins: result.wins,
        losses: result.losses,
        wr: result.wr,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        champLevel: 0,
        itemIds: [],
        itemIconUrls: [],
        gameDurationSeconds: 0,
        gameEndTimestamp: 0
      };
    })
    .filter(Boolean);
}

function extractMetaContent(html, key, attr = "name") {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<meta[^>]+${attr}=["']${escapedKey}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  return extractFirst(html, regex);
}

function extractProfileIconUrl(html) {
  const directImage = extractFirst(
    html,
    /<img[^>]+src=["'](https:\/\/[^"']*\/images\/profile_icons\/profileIcon[^"']+)["']/i
  );

  if (directImage) {
    return directImage.replace(/&amp;/g, "&");
  }

  const anyProfileIcon = extractFirst(
    html,
    /(https:\/\/[^"'\s]*\/images\/profile_icons\/profileIcon[^"'\s]+)/i
  );

  return anyProfileIcon ? anyProfileIcon.replace(/&amp;/g, "&") : null;
}

function normalizeTier(tierText) {
  if (!tierText) {
    return "Rango no disponible";
  }

  return tierText
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\b1\b/g, "I")
    .replace(/\b2\b/g, "II")
    .replace(/\b3\b/g, "III")
    .replace(/\b4\b/g, "IV");
}

function buildOpggUrl(platform, gameName, tagLine) {
  return `https://op.gg/es/lol/summoners/${encodeURIComponent(platform)}/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
}

function normalizeCacheStr(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getPlayerCacheKey(player) {
  const name = normalizeCacheStr(player.name || player.account);
  const tag = normalizeCacheStr(player.tag || "");
  return `${player.platform}:${name}${tag}`;
}

function getLegacyPlayerCacheKey(player) {
  const account = normalizeCacheStr(player.account);
  const tag = normalizeCacheStr(player.tag || "");
  return `${player.platform}:${account}${tag}`;
}

function formatShortDate(timestamp) {
  return new Date(timestamp).toLocaleDateString("es-BO", {
    day: "numeric",
    month: "short"
  });
}

function formatHistoryLabel(timestamp) {
  return new Date(timestamp).toLocaleString("es-BO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normalizeHistoryEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      timestamp: Number(entry?.timestamp) || 0,
      tier: entry?.tier || "Sin rango",
      lp: Number(entry?.lp) || 0
    }))
    .filter((entry) => entry.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildHistorySnapshot(player, cacheEntry) {
  const history = normalizeHistoryEntries(cacheEntry?.history);
  const now = Date.now();
  const currentTier = player?.tier || "Sin rango";
  const currentLp = Number(player?.lp) || 0;
  const lastEntry = history[history.length - 1];

  if (!lastEntry) {
    history.push({ timestamp: now, tier: currentTier, lp: currentLp });
    return history;
  }

  const sameRankState = lastEntry.tier === currentTier && Number(lastEntry.lp) === currentLp;
  const hasMeaningfulGap = now - lastEntry.timestamp >= 6 * 60 * 60 * 1000;

  if (!sameRankState || hasMeaningfulGap) {
    history.push({ timestamp: now, tier: currentTier, lp: currentLp });
  }

  return history.slice(-40);
}

function buildMatchPlayerLabel(participant = {}) {
  const riotId = [participant.riotIdGameName, participant.riotIdTagline].filter(Boolean).join("#");
  return riotId || participant.summonerName || "Jugador";
}

function normalizeMatchRole(participant = {}) {
  const INVALID_VALUES = new Set(["", "INVALID", "NONE", "UNSELECTED"]);
  const clean = (v) => {
    const s = String(v || "").toUpperCase().trim();
    return INVALID_VALUES.has(s) ? "" : s;
  };
  const rawRole = clean(participant.individualPosition)
    || clean(participant.teamPosition)
    || clean(participant.lane);

  if (rawRole === "TOP") return "Top";
  if (rawRole === "JUNGLE") return "Jungla";
  if (rawRole === "MIDDLE") return "Mid";
  if (rawRole === "BOTTOM") return "ADC";
  if (rawRole === "UTILITY") return "Support";
  return "Sin línea";
}

function getRoleSortValue(participant = {}) {
  const role = String(participant.individualPosition || participant.teamPosition || "").toUpperCase();
  const order = {
    TOP: 1,
    JUNGLE: 2,
    MIDDLE: 3,
    BOTTOM: 4,
    UTILITY: 5
  };

  return order[role] || 99;
}

async function fetchRecentRankedData(puuid, region) {
  const assetVersion = await getLatestDdragonVersion().catch(() => "14.24.1");
  const matchIds = await riotFetch(
    `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&start=0&count=${RECENT_MATCH_COUNT}`
  );

  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    return {
      lastChampion: null,
      series: [],
      labels: []
    };
  }

  const matchResults = await Promise.allSettled(
    matchIds.map((matchId) => riotFetch(`https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`))
  );

  const matches = matchResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((match) => match?.info?.gameMode === "CLASSIC" && Array.isArray(match?.info?.participants));

  const normalizedMatches = matches
    .map((match) => {
      const participant = match.info.participants.find((entry) => entry.puuid === puuid);

      if (!participant) {
        return null;
      }

      const itemIds = [
        participant.item0,
        participant.item1,
        participant.item2,
        participant.item3,
        participant.item4,
        participant.item5,
        participant.item6
      ].map((value) => Number(value) || 0);
      const alliedTeam = match.info.participants
        .filter((entry) => entry.teamId === participant.teamId)
        .slice()
        .sort((a, b) => getRoleSortValue(a) - getRoleSortValue(b))
        .map((entry) => ({
          name: buildMatchPlayerLabel(entry),
          championName: entry.championName || null,
          championIconUrl: entry.championName ? buildChampionIconUrl(entry.championName, assetVersion) : null
        }));
      const enemyTeam = match.info.participants
        .filter((entry) => entry.teamId !== participant.teamId)
        .slice()
        .sort((a, b) => getRoleSortValue(a) - getRoleSortValue(b))
        .map((entry) => ({
          name: buildMatchPlayerLabel(entry),
          championName: entry.championName || null,
          championIconUrl: entry.championName ? buildChampionIconUrl(entry.championName, assetVersion) : null
        }));

      return {
        matchId: match.metadata?.matchId || null,
        championName: participant.championName || null,
        win: Boolean(participant.win),
        kills: Number(participant.kills) || 0,
        deaths: Number(participant.deaths) || 0,
        assists: Number(participant.assists) || 0,
        totalMinionsKilled: Number(participant.totalMinionsKilled) || 0,
        neutralMinionsKilled: Number(participant.neutralMinionsKilled) || 0,
        champLevel: Number(participant.champLevel) || 0,
        role: normalizeMatchRole(participant),
        itemIds,
        alliedTeam,
        enemyTeam,
        gameDurationSeconds: Number(match.info.gameDuration) || 0,
        gameEndTimestamp: match.info.gameEndTimestamp || (match.info.gameCreation + (match.info.gameDuration * 1000))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.gameEndTimestamp - b.gameEndTimestamp);

  let score = 0;
  const series = [];
  const labels = [];
  const championStats = new Map();
  let totalDurationSeconds = 0;
  let durationSamples = 0;

  normalizedMatches.forEach((match) => {
    score += match.win ? 1 : -1;
    series.push(score);
    labels.push(formatShortDate(match.gameEndTimestamp));
    if (match.gameDurationSeconds > 0) {
      totalDurationSeconds += match.gameDurationSeconds;
      durationSamples += 1;
    }

    if (match.championName) {
      const current = championStats.get(match.championName) || {
        key: match.championName,
        wins: 0,
        losses: 0,
        lastPlayedAt: 0
      };

      if (match.win) {
        current.wins += 1;
      } else {
        current.losses += 1;
      }

      current.lastPlayedAt = Math.max(current.lastPlayedAt, match.gameEndTimestamp || 0);
      championStats.set(match.championName, current);
    }
  });

  const lastChampion = normalizedMatches.length ? normalizedMatches[normalizedMatches.length - 1].championName : null;
  const mostPlayedChampion = Array.from(championStats.values())
    .sort((a, b) => {
      const gamesDiff = (b.wins + b.losses) - (a.wins + a.losses);

      if (gamesDiff !== 0) {
        return gamesDiff;
      }

      return b.lastPlayedAt - a.lastPlayedAt;
    })[0] || null;
  const recentChampionStats = Array.from(championStats.values())
    .sort((a, b) => {
      const gamesDiff = (b.wins + b.losses) - (a.wins + a.losses);

      if (gamesDiff !== 0) {
        return gamesDiff;
      }

      return b.lastPlayedAt - a.lastPlayedAt;
    })
    .slice(0, 5)
    .map((champion) => ({
      ...champion,
      games: champion.wins + champion.losses,
      wr: champion.wins + champion.losses > 0
        ? Math.round((champion.wins / (champion.wins + champion.losses)) * 100)
        : 0,
      iconUrl: buildChampionIconUrl(champion.key, assetVersion)
    }));

  return {
    lastChampion,
    averageGameDurationSeconds: durationSamples > 0 ? Math.round(totalDurationSeconds / durationSamples) : 0,
    mostPlayedChampion: mostPlayedChampion
      ? {
        ...mostPlayedChampion,
        games: mostPlayedChampion.wins + mostPlayedChampion.losses,
        wr: mostPlayedChampion.wins + mostPlayedChampion.losses > 0
          ? Math.round((mostPlayedChampion.wins / (mostPlayedChampion.wins + mostPlayedChampion.losses)) * 100)
          : 0,
        iconUrl: buildChampionIconUrl(mostPlayedChampion.key, assetVersion)
      }
      : null,
    historicalChampionStats: recentChampionStats,
    recentChampionStats,
    recentMatches: normalizedMatches
      .slice()
      .sort((a, b) => b.gameEndTimestamp - a.gameEndTimestamp)
      .slice(0, 6)
      .map((match) => ({
        matchId: match.matchId || null,
        championName: match.championName,
        championIconUrl: match.championName
          ? buildChampionIconUrl(match.championName, assetVersion)
          : null,
        win: match.win,
        kills: match.kills,
        deaths: match.deaths,
        assists: match.assists,
        cs: (match.totalMinionsKilled || 0) + (match.neutralMinionsKilled || 0),
        champLevel: match.champLevel,
        role: match.role || "Sin línea",
        itemIds: match.itemIds || [],
        itemIconUrls: (match.itemIds || []).map((itemId) => itemId > 0 ? buildItemIconUrl(itemId, assetVersion) : null),
        alliedTeam: Array.isArray(match.alliedTeam) ? match.alliedTeam : [],
        enemyTeam: Array.isArray(match.enemyTeam) ? match.enemyTeam : [],
        lpChangeLabel: null,
        gameDurationSeconds: match.gameDurationSeconds,
        gameEndTimestamp: match.gameEndTimestamp
      })),
    series,
    labels
  };
}

async function getLatestDdragonVersion() {
  if (latestDdragonVersionCache) {
    return latestDdragonVersionCache;
  }

  const versionsResponse = await fetchWithTimeout("https://ddragon.leagueoflegends.com/api/versions.json");

  if (!versionsResponse.ok) {
    throw new Error(`Data Dragon ${versionsResponse.status} al pedir versiones`);
  }

  const versions = await versionsResponse.json();
  latestDdragonVersionCache = Array.isArray(versions) && versions.length ? versions[0] : "14.24.1";
  return latestDdragonVersionCache;
}

function buildChampionIconUrl(championName, version = "14.24.1") {
  return championName
    ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`
    : null;
}

function buildItemIconUrl(itemId, version = "14.24.1") {
  return itemId
    ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`
    : null;
}

function buildProfileIconUrl(profileIconId, version = "14.24.1") {
  return profileIconId
    ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${profileIconId}.png`
    : null;
}

async function getChampionNameMap() {
  if (championNameCache) {
    return championNameCache;
  }

  const latestVersion = await getLatestDdragonVersion();
  const championsResponse = await fetchWithTimeout(
    `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/es_ES/champion.json`
  );

  if (!championsResponse.ok) {
    throw new Error(`Data Dragon ${championsResponse.status} al pedir campeones`);
  }

  const payload = await championsResponse.json();
  championNameCache = Object.values(payload?.data || {}).reduce((accumulator, champion) => {
    const championId = Number.parseInt(champion?.key, 10);

    if (!Number.isNaN(championId)) {
      accumulator[championId] = champion?.name || champion?.id || null;
    }

    return accumulator;
  }, {});

  return championNameCache;
}

async function fetchTopChampion(puuid, platformHost) {
  const masteries = await riotFetch(
    `https://${platformHost}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=1`
  );

  if (!Array.isArray(masteries) || masteries.length === 0) {
    return null;
  }

  const championId = Number.parseInt(masteries[0]?.championId, 10);

  if (Number.isNaN(championId)) {
    return null;
  }

  const championMap = await getChampionNameMap();
  return championMap[championId] || null;
}

async function readProgressCache() {
  try {
    const raw = await fs.readFile(PROGRESS_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeProgressCache(cache) {
  await fs.writeFile(PROGRESS_CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function isDetailedRecentMatch(match) {
  if (!match || typeof match !== "object") {
    return false;
  }

  return Boolean(
    Number(match.gameEndTimestamp) > 0
    || Number(match.gameDurationSeconds) > 0
    || Number(match.kills) > 0
    || Number(match.deaths) > 0
    || Number(match.assists) > 0
    || (Array.isArray(match.itemIds) && match.itemIds.length > 0)
    || (Array.isArray(match.itemIconUrls) && match.itemIconUrls.length > 0)
  );
}

function filterRecentWindow(matches = []) {
  const now = Date.now();

  return matches.filter((match) => {
    const timestamp = Number(match?.gameEndTimestamp) || 0;

    if (!timestamp) {
      return false;
    }

    return now - timestamp <= CACHE_RECENT_MATCH_WINDOW_MS;
  });
}

function dedupeRecentMatches(matches = []) {
  // Pre-register signatures of timestamped matches so timestamp-0 duplicates
  // (e.g. from OP.GG fallback) are dropped when a richer Riot API version exists.
  const timestampedSigs = new Set();
  for (const match of matches) {
    if (Number(match.gameEndTimestamp) > 0) {
      timestampedSigs.add([
        match.championName || "",
        Number(match.kills) || 0,
        Number(match.deaths) || 0,
        Number(match.assists) || 0,
        Number(match.gameDurationSeconds) || 0
      ].join("|"));
    }
  }

  const seen = new Set();
  return matches.filter((match) => {
    const key = [
      match.championName || "",
      Number(match.gameEndTimestamp) || 0,
      Number(match.kills) || 0,
      Number(match.deaths) || 0,
      Number(match.assists) || 0,
      Array.isArray(match.itemIds) ? match.itemIds.join("-") : ""
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    // Drop timestamp-0 (OP.GG scrape) entries when a timestamped match
    // with the same champion/KDA/duration is already present.
    if (!Number(match.gameEndTimestamp)) {
      const sig = [
        match.championName || "",
        Number(match.kills) || 0,
        Number(match.deaths) || 0,
        Number(match.assists) || 0,
        Number(match.gameDurationSeconds) || 0
      ].join("|");
      if (timestampedSigs.has(sig)) {
        return false;
      }
    }

    return true;
  });
}

function matchSoftKey(match) {
  return [
    match.championName || "",
    Number(match.kills) || 0,
    Number(match.deaths) || 0,
    Number(match.assists) || 0,
    Number(match.gameDurationSeconds) || 0
  ].join("|");
}

function mergeRecentMatchesWithCache(liveMatches = [], cachedMatches = []) {
  const liveDetailed = (Array.isArray(liveMatches) ? liveMatches : []).filter(isDetailedRecentMatch);
  const cachedDetailed = filterRecentWindow(
    (Array.isArray(cachedMatches) ? cachedMatches : []).filter(isDetailedRecentMatch)
  );
  const cachedAny = Array.isArray(cachedMatches) ? cachedMatches.slice(0, SPOTLIGHT_MATCH_COUNT) : [];
  const liveAny = Array.isArray(liveMatches) ? liveMatches.slice(0, SPOTLIGHT_MATCH_COUNT) : [];

  // Live matches always win: drop cached entries that have a live counterpart
  // with the same champion/KDA/duration (even when itemIds differ between cache versions).
  const liveSoftKeys = new Set(liveDetailed.map(matchSoftKey));
  const filteredCached = cachedDetailed.filter((m) => !liveSoftKeys.has(matchSoftKey(m)));

  const merged = dedupeRecentMatches([...liveDetailed, ...filteredCached])
    .sort((a, b) => (Number(b.gameEndTimestamp) || 0) - (Number(a.gameEndTimestamp) || 0))
    .slice(0, SPOTLIGHT_MATCH_COUNT);

  if (merged.length) {
    return merged;
  }

  if (cachedAny.length >= liveAny.length) {
    return cachedAny;
  }

  return liveAny;
}

function mergePlayerWithCache(player, cacheEntry) {
  const hasLiveSeries = Array.isArray(player.series) && player.series.length > 1;

  if (hasLiveSeries || !cacheEntry) {
    return player;
  }

  return {
    ...player,
    lastChampion: player.lastChampion || cacheEntry.lastChampion || null,
    history: Array.isArray(cacheEntry.history) ? cacheEntry.history : [],
    series: Array.isArray(cacheEntry.series) ? cacheEntry.series : [],
    labels: Array.isArray(cacheEntry.labels) ? cacheEntry.labels : [],
    sourceLabel: `${player.sourceLabel || "Actualizado"} · progreso guardado`
  };
}

function mergePlayerWithCacheStable(player, cacheEntry) {
  const hasLiveSeries = Array.isArray(player.series) && player.series.length > 1;
  const mergedRecentMatches = mergeRecentMatchesWithCache(player.recentMatches, cacheEntry?.recentMatches);
  const mergedRecentChampionStats = Array.isArray(player.recentChampionStats) && player.recentChampionStats.length
    ? player.recentChampionStats
    : (Array.isArray(cacheEntry?.recentChampionStats) ? cacheEntry.recentChampionStats : []);
  const mergedHistoricalChampionStats = Array.isArray(player.historicalChampionStats) && player.historicalChampionStats.length
    ? player.historicalChampionStats
    : (Array.isArray(cacheEntry?.historicalChampionStats) ? cacheEntry.historicalChampionStats : []);
  const mergedMostPlayedChampion = player.mostPlayedChampion || cacheEntry?.mostPlayedChampion || null;
  const history = buildHistorySnapshot(player, cacheEntry);
  const historyLabels = history.map((entry) => formatHistoryLabel(entry.timestamp));

  if (hasLiveSeries || !cacheEntry) {
    return {
      ...player,
      history,
      labels: historyLabels.length > 1 ? historyLabels : player.labels,
      recentMatches: mergedRecentMatches,
      recentChampionStats: mergedRecentChampionStats,
      historicalChampionStats: mergedHistoricalChampionStats,
      mostPlayedChampion: mergedMostPlayedChampion
    };
  }

  return {
    ...player,
    lastChampion: player.lastChampion || cacheEntry.lastChampion || null,
    history,
    series: Array.isArray(cacheEntry.series) ? cacheEntry.series : [],
    labels: historyLabels.length > 1 ? historyLabels : (Array.isArray(cacheEntry.labels) ? cacheEntry.labels : []),
    recentMatches: mergedRecentMatches,
    recentChampionStats: mergedRecentChampionStats,
    historicalChampionStats: mergedHistoricalChampionStats,
    mostPlayedChampion: mergedMostPlayedChampion,
    sourceLabel: `${player.sourceLabel || "Actualizado"} · progreso guardado`
  };
}

function extractSoloQueueBlock(text) {
  return extractFirst(
    text,
    /(Clasificatoria solo\/d.{1,4}o[\s\S]{0,2400}?)(?:Clasificatoria flexible|Resumen Campeones|ResumenCampeones|Maestr..a|Partida en vivo|Teamfight Tactics|$)/i
  ) || text;
}

function parseOpggMetaDescription(description) {
  if (!description) {
    return null;
  }

  const plain = decodeHtmlEntities(description).replace(/\s+/g, " ").trim();
  const segments = plain.split(/\s*\/\s*/).map((segment) => segment.trim()).filter(Boolean);
  const rankSegment = segments[1] || "";
  const wlSegment = segments[2] || "";

  const tierMatch = rankSegment.match(
    /\b(Challenger|Grandmaster|Master|Diamond|Emerald|Platinum|Gold|Silver|Bronze|Iron|Unranked)\b\s*([1-4IV]{1,3})?/i
  );
  const lpMatch = rankSegment.match(/(\d+)\s*LP\b/i);
  const wlMatch = wlSegment.match(
    /(\d+)\s*(?:Victoria|Victorias|Win|Wins|W)\s*(\d+)\s*(?:Derrota|Derrotas|Loss|Losses|L)\s*(?:Tasa de victoria|Win ?Rate)?\s*(\d+)%/i
  );

  if (!tierMatch && !lpMatch && !wlMatch) {
    return null;
  }

  const wins = wlMatch ? Number.parseInt(wlMatch[1], 10) : 0;
  const losses = wlMatch ? Number.parseInt(wlMatch[2], 10) : 0;

  return {
    tier: tierMatch ? normalizeTier([tierMatch[1], tierMatch[2]].filter(Boolean).join(" ")) : "Rango no disponible",
    lp: lpMatch ? Number.parseInt(lpMatch[1], 10) : 0,
    wins,
    losses,
    wr: wlMatch
      ? Number.parseInt(wlMatch[3], 10)
      : (wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0)
  };
}

// Normaliza el nombre de un campeón al formato DDragon (sin espacios, sin apóstrofes, sin acentos)
// Ej: "Kai'Sa" -> "KaiSa", "Nunu & Willump" -> "Nunu", "Cho'Gath" -> "Chogath"
function normalizeDdragonName(name = "") {
  return name
    .replace(/[''`]/g, "")        // apóstrofes
    .replace(/\s*&\s*.+$/, "")    // "& Willump" etc.
    .replace(/\s+/g, "")          // espacios
    .replace(/[àáâãä]/gi, "a")
    .replace(/[èéêë]/gi, "e")
    .replace(/[ìíîï]/gi, "i")
    .replace(/[òóôõö]/gi, "o")
    .replace(/[ùúûü]/gi, "u")
    .replace(/[^a-zA-Z0-9]/g, ""); // cualquier otro carácter raro
}

// Parsea el segmento de campeones del meta description de OP.GG
// Formato: "Katarina - 21Victoria 19Derrota Tasa de victoria 53%, Zoe - 10Victoria 12Derrota Tasa de victoria 45%, ..."
function parseOpggMetaChampionStats(description, assetVersion = "14.24.1") {
  if (!description) return [];

  const plain = decodeHtmlEntities(description).replace(/\s+/g, " ").trim();
  // El cuarto segmento (índice 3) contiene la lista de campeones separados por coma
  // Formato completo: "NombreInvocador / Tier LP / Wins Losses WR% / Champ1 - W1V L1D WR%, Champ2 - ..."
  const segments = plain.split(/\s*\/\s*/);
  const champSegment = segments[3] || "";

  if (!champSegment) return [];

  return champSegment
    .split(/\s*,\s*/)
    .map((entry) => {
      // "Katarina - 21Victoria 19Derrota Tasa de victoria 53%"
      const m = entry.match(
        /^(.+?)\s*-\s*(\d+)\s*Victoria[s]?\s*(\d+)\s*Derrota[s]?\s*(?:Tasa de victoria\s*)?(\d+)%/i
      );
      if (!m) return null;
      const key = m[1].trim();
      const wins = Number.parseInt(m[2], 10) || 0;
      const losses = Number.parseInt(m[3], 10) || 0;
      const wr = Number.parseInt(m[4], 10) || 0;
      const ddragonKey = normalizeDdragonName(key);
      return {
        key,
        wins,
        losses,
        wr,
        games: wins + losses,
        iconUrl: buildChampionIconUrl(ddragonKey, assetVersion)
      };
    })
    .filter(Boolean);
}

function parseOpggFallback(html, config, assetVersion = "14.24.1") {
  const plain = htmlToPlainText(html);
  const solo = extractSoloQueueBlock(plain);
  const title = extractMetaContent(html, "og:title", "property")
    || extractMetaContent(html, "twitter:title")
    || extractFirst(plain, /([^\s]+#[^\s]+)\s*-\s*(?:Estad..sticas|Summoner Stats|Stats)/i);
  const description = extractMetaContent(html, "description")
    || extractMetaContent(html, "og:description", "property")
    || extractMetaContent(html, "twitter:description");
  const avatarUrl = extractProfileIconUrl(html)
    || extractMetaContent(html, "og:image", "property")
    || extractMetaContent(html, "twitter:image");
  const metaData = parseOpggMetaDescription(description);

  // Stats de campeones de la temporada completa, desde el meta description
  const metaChampionStats = parseOpggMetaChampionStats(description, assetVersion);
  const opggTopChampionName = extractFirst(
    html,
    /"champion_name":"([^"]+)"/i
  );
  const opggTopChampionImage = extractFirst(
    html,
    /"champion_image_url":"([^"]+)"/i
  )?.replace(/\\u0026/g, "&");
  const opggChampionTableMatch = html.match(
    /href="\/es\/lol\/champions\/[^"]+"[^>]*><img[^>]+src="([^"]+)"[^>]*><span[^>]*>([^<]+)<\/span><\/a>[\s\S]{0,900}?>(\d+)<!-- -->V<\/span>[\s\S]{0,400}?>(\d+)<!-- -->D<\/span>[\s\S]{0,400}?<span class="basis-7[^"]*"[^>]*>(\d+)%<\/span>/i
  );
  const opggChampionRowMatches = Array.from(
    html.matchAll(
      /href="\/es\/lol\/champions\/[^"]+"[^>]*><img[^>]+src="([^"]+)"[^>]*><span[^>]*>([^<]+)<\/span><\/a>[\s\S]{0,900}?>(\d+)<!-- -->V<\/span>[\s\S]{0,400}?>(\d+)<!-- -->D<\/span>[\s\S]{0,400}?<span class="basis-7[^"]*"[^>]*>(\d+)%<\/span>/gi
    )
  )
    .slice(0, 5)
    .map((match) => ({
      iconUrl: match[1].replace(/&amp;/g, "&"),
      key: match[2],
      wins: Number.parseInt(match[3], 10) || 0,
      losses: Number.parseInt(match[4], 10) || 0,
      wr: Number.parseInt(match[5], 10) || 0,
      games: (Number.parseInt(match[3], 10) || 0) + (Number.parseInt(match[4], 10) || 0)
    }));
  const durationMatches = Array.from(
    html.matchAll(/>(\d{1,2})m (\d{1,2})s<\/span>/gi)
  )
    .slice(0, RECENT_MATCH_COUNT)
    .map((match) => ((Number.parseInt(match[1], 10) || 0) * 60) + (Number.parseInt(match[2], 10) || 0))
    .filter((seconds) => seconds > 0);
  const averageGameDurationSeconds = durationMatches.length
    ? Math.round(durationMatches.reduce((sum, value) => sum + value, 0) / durationMatches.length)
    : 0;
  const opggMatchResults = Array.from(
    html.matchAll(/>(Victoria|Derrota)<\/div>/gi)
  )
    .slice(0, 6)
    .map((match) => String(match[1]).toLowerCase() === "victoria");
  const opggTableChampion = opggChampionTableMatch
    ? {
      iconUrl: opggChampionTableMatch[1].replace(/&amp;/g, "&"),
      key: opggChampionTableMatch[2],
      wins: Number.parseInt(opggChampionTableMatch[3], 10) || 0,
      losses: Number.parseInt(opggChampionTableMatch[4], 10) || 0,
      wr: Number.parseInt(opggChampionTableMatch[5], 10) || 0
    }
    : null;
  const opggRecentCards = extractOpggRecentCards(html);

  const tierMatch = solo.match(
    /\b(challenger|grandmaster|master|diamond\s*[1-4iv]{1,3}|emerald\s*[1-4iv]{1,3}|platinum\s*[1-4iv]{1,3}|gold\s*[1-4iv]{1,3}|silver\s*[1-4iv]{1,3}|bronze\s*[1-4iv]{1,3}|iron\s*[1-4iv]{1,3}|unranked)\b/i
  );
  const lpMatch = solo.match(/\b(\d+)\s*LP\b/i);
  const wlMatch = solo.match(
    /(\d+)\s*(?:Victoria|Victorias|Win|Wins|W)\s*(\d+)\s*(?:Derrota|Derrotas|Loss|Losses|L)[\s\S]{0,120}?(?:Tasa de victoria|WinRate|Win rate|Taxa de vit[oó]ria)\s*(\d+)%/i
  );

  const normalizedTier = metaData?.tier || (tierMatch ? normalizeTier(tierMatch[1]) : "Rango no disponible");
  const wins = metaData?.wins ?? (wlMatch ? Number.parseInt(wlMatch[1], 10) : 0);
  const losses = metaData?.losses ?? (wlMatch ? Number.parseInt(wlMatch[2], 10) : 0);
  const wr = metaData?.wr ?? (wlMatch ? Number.parseInt(wlMatch[3], 10) : 0);
  const lp = metaData?.lp ?? (lpMatch ? Number.parseInt(lpMatch[1], 10) : 0);
  const riotId = extractFirst(title || "", /^(.+?#.+?)\s*-/) || title || `${config.gameName}#${config.tagLine}`;
  const [accountName, tagLine] = riotId.split("#");

  return {
    name: config.nickname,
    role: config.role,
    account: accountName || config.gameName,
    tag: `#${tagLine || config.tagLine}`,
    platform: config.platform,
    opggUrl: config.opggUrl || buildOpggUrl(config.platform, accountName || config.gameName, tagLine || config.tagLine),
    tier: normalizedTier,
    lp,
    wins,
    losses,
    wr,
    averageGameDurationSeconds,
    topChampion: opggTopChampionName || null,
    // Prioridad: meta description (stats de temporada completa) > tabla HTML (solo recientes)
    mostPlayedChampion: metaChampionStats.length > 0
      ? metaChampionStats[0]
      : opggTableChampion
        ? { ...opggTableChampion, games: opggTableChampion.wins + opggTableChampion.losses }
        : opggTopChampionName
          ? { key: opggTopChampionName, wins: 0, losses: 0, games: 0, wr: 0, iconUrl: opggTopChampionImage || null }
          : null,
    historicalChampionStats: metaChampionStats.length > 0
      ? metaChampionStats
      : opggChampionRowMatches,
    recentChampionStats: opggChampionRowMatches,
    recentMatches: opggRecentCards.length
      ? opggRecentCards
      : opggMatchResults.map((win, index) => ({
        championName: opggChampionRowMatches[index]?.key || opggTableChampion?.key || opggTopChampionName || null,
        championIconUrl: opggChampionRowMatches[index]?.iconUrl || opggTableChampion?.iconUrl || opggTopChampionImage || null,
        win,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        champLevel: 0,
        role: "Sin línea",
        itemIds: [],
        itemIconUrls: [],
        alliedTeam: [],
        enemyTeam: [],
        lpChangeLabel: null,
        gameDurationSeconds: durationMatches[index] || averageGameDurationSeconds || 0,
        gameEndTimestamp: 0
      })),
    sourceLabel: "Actualizado con OP.GG",
    avatarUrl,
    color: config.color,
    source: "opgg"
  };
}

// Trae sólo el meta description de OP.GG y extrae el histórico de temporada
// completa de campeones (21W/19L Katarina, 10W/12L Zoe, etc.). Se usa como
// fuente autoritativa para `historicalChampionStats` porque Riot match-v5
// sólo devuelve ~20 partidas recientes, no la temporada entera.
async function fetchOpggSeasonChampionStats(config) {
  if (!config.opggUrl) return null;

  let res;
  try {
    res = await fetchWithTimeout(config.opggUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const html = await res.text();
  const description = extractMetaContent(html, "description")
    || extractMetaContent(html, "og:description", "property")
    || extractMetaContent(html, "twitter:description");

  if (!description) return null;

  const assetVersion = await getLatestDdragonVersion().catch(() => "14.24.1");
  const metaChampionStats = parseOpggMetaChampionStats(description, assetVersion);

  if (!Array.isArray(metaChampionStats) || metaChampionStats.length === 0) {
    return null;
  }

  // Considerar histórico válido sólo si al menos un campeón tiene >5 partidas
  // (evita confundir 2-2 recientes con histórico de temporada)
  const hasSeasonData = metaChampionStats.some(
    (c) => (Number(c.wins) || 0) + (Number(c.losses) || 0) > 5
  );

  return hasSeasonData ? metaChampionStats : null;
}

const UGG_PLATFORM_MAP = {
  LA1: "la1", LA2: "las", NA1: "na1", BR1: "br1",
  EUW1: "euw1", EUN1: "eune1", KR: "kr", JP1: "jp1",
  TR1: "tr1", RU: "ru", OC1: "oce1"
};

async function fetchUggData(config, page = 1) {
  const regionId = UGG_PLATFORM_MAP[config.platform] || "la1";
  const body = JSON.stringify({
    query: `{ fetchPlayerMatchSummaries(regionId: "${regionId}", riotUserName: ${JSON.stringify(config.gameName)}, riotTagLine: ${JSON.stringify(config.tagLine)}, queueType: [420], page: ${page}, processLp: true, seasonIds: [25, 26]) { matchSummaries { matchId championId kills deaths assists cs win gameCreatedAt gameDuration lpInfo { lp } } } }`
  });

  let res;
  try {
    res = await fetchWithTimeout("https://u.gg/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Origin": "https://u.gg"
      },
      body
    });
  } catch {
    return { lpMap: new Map(), matches: [] };
  }

  if (!res.ok) return { lpMap: new Map(), matches: [] };

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { lpMap: new Map(), matches: [] };
  }

  const summaries = payload?.data?.fetchPlayerMatchSummaries?.matchSummaries;
  if (!Array.isArray(summaries)) return { lpMap: new Map(), matches: [] };

  const lpMap = new Map();
  const matches = [];
  for (const s of summaries) {
    const lp = s?.lpInfo?.lp;
    if (s?.matchId != null && lp != null && lp !== 0) {
      lpMap.set(Number(s.matchId), Number(lp));
    }
    if (s?.matchId != null) {
      matches.push(s);
    }
  }
  return { lpMap, matches };
}

function normalizeRiotMatch(match, puuid, assetVersion, lpMap = new Map()) {
  const participant = match?.info?.participants?.find((p) => p.puuid === puuid);
  if (!participant) return null;

  const matchId = match.metadata?.matchId || null;
  const numericId = Number(String(matchId || "").split("_").pop());
  const lp = numericId ? lpMap.get(numericId) : undefined;
  const lpChangeLabel = lp != null && lp !== 0
    ? (lp > 0 ? `+${lp} LP` : `${lp} LP`)
    : null;

  const itemIds = [
    participant.item0, participant.item1, participant.item2,
    participant.item3, participant.item4, participant.item5, participant.item6
  ].map((v) => Number(v) || 0);

  const alliedTeam = match.info.participants
    .filter((e) => e.teamId === participant.teamId)
    .sort((a, b) => getRoleSortValue(a) - getRoleSortValue(b))
    .map((e) => ({ name: buildMatchPlayerLabel(e), championName: e.championName || null, championIconUrl: e.championName ? buildChampionIconUrl(e.championName, assetVersion) : null }));

  const enemyTeam = match.info.participants
    .filter((e) => e.teamId !== participant.teamId)
    .sort((a, b) => getRoleSortValue(a) - getRoleSortValue(b))
    .map((e) => ({ name: buildMatchPlayerLabel(e), championName: e.championName || null, championIconUrl: e.championName ? buildChampionIconUrl(e.championName, assetVersion) : null }));

  return {
    matchId,
    championName: participant.championName || null,
    championIconUrl: participant.championName ? buildChampionIconUrl(participant.championName, assetVersion) : null,
    win: Boolean(participant.win),
    kills: Number(participant.kills) || 0,
    deaths: Number(participant.deaths) || 0,
    assists: Number(participant.assists) || 0,
    cs: (Number(participant.totalMinionsKilled) || 0) + (Number(participant.neutralMinionsKilled) || 0),
    champLevel: Number(participant.champLevel) || 0,
    role: normalizeMatchRole(participant),
    itemIds,
    itemIconUrls: itemIds.map((id) => id > 0 ? buildItemIconUrl(id, assetVersion) : null),
    alliedTeam,
    enemyTeam,
    lpChangeLabel,
    gameDurationSeconds: Number(match.info.gameDuration) || 0,
    gameEndTimestamp: match.info.gameEndTimestamp || (match.info.gameCreation + (match.info.gameDuration * 1000))
  };
}

function uggSummaryToMatch(s, championMap, assetVersion) {
  const championName = s.championId ? (championMap[Number(s.championId)] || null) : null;
  const lp = s.lpInfo?.lp;
  const lpChangeLabel = lp != null && lp !== 0
    ? (lp > 0 ? `+${lp} LP` : `${lp} LP`)
    : null;
  const gameEnd = s.gameCreatedAt
    ? (Number(s.gameCreatedAt) * 1000) + (Number(s.gameDuration) || 0) * 1000
    : 0;
  return {
    matchId: s.matchId ? `LA1_${s.matchId}` : null,
    championName,
    championIconUrl: championName ? buildChampionIconUrl(championName, assetVersion) : null,
    win: s.win != null ? Boolean(s.win) : (lp != null ? lp > 0 : false),
    kills: Number(s.kills) || 0,
    deaths: Number(s.deaths) || 0,
    assists: Number(s.assists) || 0,
    cs: Number(s.cs) || 0,
    champLevel: 0,
    role: "Sin línea",
    itemIds: [],
    itemIconUrls: [],
    alliedTeam: [],
    enemyTeam: [],
    lpChangeLabel,
    gameDurationSeconds: Number(s.gameDuration) || 0,
    gameEndTimestamp: gameEnd
  };
}

async function handlePlayerMatches(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const nickname = url.searchParams.get("player");
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

    const content = await fs.readFile(ACCOUNTS_PATH, "utf8");
    const accounts = JSON.parse(content);
    const config = accounts.players.find((p) => p.nickname === nickname);

    if (!config) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Jugador no encontrado", matches: [] }));
      return;
    }

    const start = 5 + (page - 1) * 10;
    const count = 10;
    const region = regionRoute(config.platform);
    const assetVersion = await getLatestDdragonVersion().catch(() => "14.24.1");

    // u.gg page that covers this offset (each u.gg page = 20 matches)
    const uggPage = Math.floor(start / 20) + 1;
    const uggData = await fetchUggData(config, uggPage).catch(() => ({ lpMap: new Map(), matches: [] }));
    // Also grab page 1 when needed for LP of matches near the boundary
    const uggData1 = uggPage > 1
      ? await fetchUggData(config, 1).catch(() => ({ lpMap: new Map(), matches: [] }))
      : uggData;
    const combinedLpMap = new Map([...uggData1.lpMap, ...uggData.lpMap]);

    let matches = [];
    let usedRiot = false;

    try {
      const account = await riotFetch(
        `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(config.gameName)}/${encodeURIComponent(config.tagLine)}`
      );
      const matchIds = await riotFetch(
        `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?queue=420&start=${start}&count=${count}`
      );

      if (Array.isArray(matchIds) && matchIds.length > 0) {
        const results = await Promise.allSettled(
          matchIds.map((id) => riotFetch(`https://${region}.api.riotgames.com/lol/match/v5/matches/${id}`))
        );
        matches = results
          .filter((r) => r.status === "fulfilled")
          .map((r) => r.value)
          .filter((m) => m?.info?.gameMode === "CLASSIC" && Array.isArray(m?.info?.participants))
          .map((m) => normalizeRiotMatch(m, account.puuid, assetVersion, combinedLpMap))
          .filter(Boolean)
          .sort((a, b) => (Number(b.gameEndTimestamp) || 0) - (Number(a.gameEndTimestamp) || 0));
        usedRiot = true;
      }
    } catch {
      // Riot failed — fall back to u.gg data for this page slice
    }

    if (!usedRiot) {
      const allUggMatches = uggData.matches;
      const sliceStart = start - (uggPage - 1) * 20;
      const sliced = allUggMatches.slice(sliceStart, sliceStart + count);
      if (sliced.length > 0) {
        const championMap = await getChampionNameMap().catch(() => ({}));
        matches = sliced.map((s) => uggSummaryToMatch(s, championMap, assetVersion));
      }
    }

    const hasMore = matches.length === count;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ matches, hasMore }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message, matches: [] }));
  }
}

async function fetchOpggFallback(config) {
  if (!config.opggUrl) {
    throw new Error(`No hay opggUrl para ${config.nickname}`);
  }

  let res;

  try {
    res = await fetchWithTimeout(config.opggUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`OP.GG timeout para ${config.nickname}`);
    }

    throw new Error(`Fallo de red con OP.GG para ${config.nickname}: ${error.message}`);
  }

  if (!res.ok) {
    throw new Error(`OP.GG ${res.status} para ${config.nickname}`);
  }

  const html = await res.text();
  const assetVersion = await getLatestDdragonVersion().catch(() => "14.24.1");
  return parseOpggFallback(html, config, assetVersion);
}

async function fetchPlayer(config) {
  const { gameName, tagLine, platform } = config;
  const region = regionRoute(platform);
  const platformHost = platform.toLowerCase();

  const account = await riotFetch(
    `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );

  const summoner = await riotFetch(
    `https://${platformHost}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`
  );

  const leagues = await riotFetch(
    `https://${platformHost}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}`
  );
  const [recent, topChampion, opggSeasonChampions, uggData] = await Promise.all([
    fetchRecentRankedData(account.puuid, region).catch(() => ({
      lastChampion: null,
      averageGameDurationSeconds: 0,
      mostPlayedChampion: null,
      historicalChampionStats: [],
      recentChampionStats: [],
      recentMatches: [],
      series: [],
      labels: []
    })),
    fetchTopChampion(account.puuid, platformHost).catch(() => null),
    fetchOpggSeasonChampionStats(config).catch(() => null),
    fetchUggData(config).catch(() => ({ lpMap: new Map(), matches: [] }))
  ]);
  const uggLpMap = uggData.lpMap;

  const solo = leagues.find((queue) => queue.queueType === "RANKED_SOLO_5x5")
    || leagues.find((queue) => queue.queueType === "RANKED_FLEX_SR");

  const wins = solo?.wins || 0;
  const losses = solo?.losses || 0;
  const assetVersion = await getLatestDdragonVersion().catch(() => "14.24.1");

  // Histórico de temporada: prioridad al scrape de OP.GG (tiene 21-19 Katarina,
  // 10-12 Zoe, etc.). Si no está disponible, caemos al agregado de match-v5
  // (que son sólo ~20 partidas recientes).
  const historicalChampionStats = (Array.isArray(opggSeasonChampions) && opggSeasonChampions.length)
    ? opggSeasonChampions
    : recent.historicalChampionStats;

  // El "campeón principal" de la tarjeta también debe reflejar el histórico
  // de temporada, no los 4 últimos juegos.
  const mostPlayedChampion = (Array.isArray(opggSeasonChampions) && opggSeasonChampions.length)
    ? opggSeasonChampions[0]
    : recent.mostPlayedChampion;

  return {
    name: config.nickname,
    role: config.role,
    account: account.gameName || gameName,
    tag: `#${account.tagLine || tagLine}`,
    platform,
    opggUrl: config.opggUrl || buildOpggUrl(platform, account.gameName || gameName, account.tagLine || tagLine),
    tier: solo ? `${solo.tier} ${solo.rank}` : "Sin rango",
    lp: solo?.leaguePoints || 0,
    wins,
    losses,
    wr: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
    topChampion,
    lastChampion: recent.lastChampion,
    averageGameDurationSeconds: recent.averageGameDurationSeconds,
    mostPlayedChampion,
    historicalChampionStats,
    recentChampionStats: recent.recentChampionStats,
    recentMatches: await (async () => {
      const riotMatches = recent.recentMatches.map((match) => {
        // matchId from Riot is "LA1_1711712798"; U.GG uses only the numeric suffix
        const numericId = Number(String(match.matchId || "").split("_").pop());
        const lp = uggLpMap.size > 0 && numericId ? uggLpMap.get(numericId) : undefined;
        const lpChangeLabel = lp != null && lp !== 0
          ? (lp > 0 ? `+${lp} LP` : `${lp} LP`)
          : null;
        return { ...match, lpChangeLabel };
      });

      if (riotMatches.length > 0) return riotMatches;

      // Riot returned no matches — fall back to u.gg match summaries
      const uggRaw = uggData.matches;
      if (!uggRaw.length) return [];

      const championMap = await getChampionNameMap().catch(() => ({}));
      return uggRaw.slice(0, 6).map((s) => uggSummaryToMatch(s, championMap, assetVersion));
    })(),
    series: recent.series,
    labels: recent.labels,
    sourceLabel: "Actualizado con Riot API",
    avatarUrl: buildProfileIconUrl(summoner.profileIconId, assetVersion),
    color: config.color,
    source: "riot"
  };
}

async function fetchPlayerHybrid(config) {
  try {
    return await fetchPlayer(config);
  } catch (riotError) {
    try {
      return await fetchOpggFallback(config);
    } catch (opggError) {
      throw new Error(`${config.nickname}: Riot fallo (${riotError.message}) y OP.GG fallo (${opggError.message})`);
    }
  }
}

async function handlePlayers(res) {
  try {
    const content = await fs.readFile(ACCOUNTS_PATH, "utf8");
    const accounts = JSON.parse(content);
    const progressCache = await readProgressCache();

    // Migrar claves del caché al formato normalizado (elimina duplicados por acentos)
    const migratedCache = {};
    for (const [key, val] of Object.entries(progressCache)) {
      const colonIdx = key.indexOf(":");
      const platform = key.slice(0, colonIdx);
      const rest = key.slice(colonIdx + 1);
      const normKey = platform + ":" + normalizeCacheStr(rest);
      if (!migratedCache[normKey]) {
        migratedCache[normKey] = val;
      } else {
        // Fusionar prefiriendo el entry con más datos históricos
        const existing = migratedCache[normKey];
        const existHist = existing.historicalChampionStats || [];
        const valHist = val.historicalChampionStats || [];
        // Si todos los campeones tienen <= 5 partidas, son datos recientes scrapeados — descartarlos
        const existStale = existHist.length > 0 && existHist.every(c => (c.wins || 0) + (c.losses || 0) <= 5);
        const valStale = valHist.length > 0 && valHist.every(c => (c.wins || 0) + (c.losses || 0) <= 5);
        migratedCache[normKey] = {
          ...existing, ...val,
          mostPlayedChampion: (!existStale && existing.mostPlayedChampion) || (!valStale && val.mostPlayedChampion) || null,
          historicalChampionStats: !existStale && existHist.length >= valHist.length ? existHist : (!valStale ? valHist : []),
          recentChampionStats: (val.recentChampionStats || []).length ? val.recentChampionStats : (existing.recentChampionStats || []),
          recentMatches: (val.recentMatches || []).length ? val.recentMatches : (existing.recentMatches || [])
        };
      }
    }
    // Reemplazar el caché en memoria con el migrado
    Object.keys(progressCache).forEach(k => delete progressCache[k]);
    Object.assign(progressCache, migratedCache);

    // Limpieza de entries "stale": si el historicalChampionStats guardado tiene
    // todos los campeones con <=5 partidas, no es histórico de temporada — son
    // partidas recientes scrapeadas por error. Lo vaciamos para que la próxima
    // llamada a fetchOpggSeasonChampionStats lo sobrescriba con el histórico real.
    for (const entry of Object.values(progressCache)) {
      const hist = entry.historicalChampionStats || [];
      if (hist.length > 0 && hist.every((c) => (Number(c.wins) || 0) + (Number(c.losses) || 0) <= 5)) {
        entry.historicalChampionStats = [];
        entry.mostPlayedChampion = null;
      }
    }

    const results = await Promise.allSettled(accounts.players.map((player) => fetchPlayerHybrid(player)));
    const players = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => {
        const player = result.value;
        const cacheEntry = progressCache[getPlayerCacheKey(player)];
        return mergePlayerWithCacheStable(player, cacheEntry);
      });
    const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason.message);

    if (players.length === 0) {
      throw new Error(errors.join(" | "));
    }

    players.forEach((player) => {
      const existingEntry = progressCache[getPlayerCacheKey(player)] || {};
      const history = Array.isArray(player.history) ? player.history : buildHistorySnapshot(player, existingEntry);
      progressCache[getPlayerCacheKey(player)] = {
        history,
        lastChampion: player.lastChampion || existingEntry.lastChampion || null,
        labels: Array.isArray(player.labels) && player.labels.length ? player.labels : (existingEntry.labels || []),
        savedAt: new Date().toISOString(),
        series: Array.isArray(player.series) && player.series.length ? player.series : (existingEntry.series || []),
        recentMatches: Array.isArray(player.recentMatches) ? player.recentMatches.slice(0, SPOTLIGHT_MATCH_COUNT) : [],
        mostPlayedChampion: player.mostPlayedChampion || existingEntry.mostPlayedChampion || null,
        historicalChampionStats: Array.isArray(player.historicalChampionStats) && player.historicalChampionStats.length
          ? player.historicalChampionStats
          : (existingEntry.historicalChampionStats || []),
        recentChampionStats: Array.isArray(player.recentChampionStats) && player.recentChampionStats.length
          ? player.recentChampionStats
          : (existingEntry.recentChampionStats || [])
      };
    });

    await writeProgressCache(progressCache);

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      fetchedAt: new Date().toISOString(),
      players,
      target: accounts.targetRank,
      queueLabel: "SoloQ",
      servers: [...new Set(players.map((player) => player.platform).filter(Boolean))],
      errors
    }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function serveStatic(req, res) {
  const file = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(ROOT, file);
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function handleLive(res) {
  try {
    const content = await fs.readFile(ACCOUNTS_PATH, "utf8");
    const accounts = JSON.parse(content);

    const results = await Promise.allSettled(
      accounts.players.map(async (player) => {
        const region = regionRoute(player.platform);
        const platformHost = player.platform.toLowerCase();

        const account = await riotFetch(
          `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(player.gameName)}/${encodeURIComponent(player.tagLine)}`
        );

        let inGame = false;
        try {
          const spectator = await riotFetch(
            `https://${platformHost}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${account.puuid}`
          );
          inGame = spectator?.gameId > 0;
        } catch {
          inGame = false;
        }

        return { name: player.nickname, inGame };
      })
    );

    const liveStatus = {};
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        liveStatus[result.value.name] = result.value.inGame;
      }
    });

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ liveStatus, checkedAt: new Date().toISOString() }));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/players")) {
    handlePlayers(res);
  } else if (req.url.startsWith("/api/live")) {
    handleLive(res);
  } else if (req.url.startsWith("/api/player-matches")) {
    handlePlayerMatches(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`http://${HOST}:${PORT}`);
});
