let players = [];
let labels = [];
let activePlayerIndex = 0;
let currentTargetRank = "GrandMaster";
let activeTracker = "opgg";

const platformSlug = {
  LA1: "lan", LA2: "las", NA1: "na", BR1: "br",
  EUW1: "euw", EUN1: "eune", KR: "kr", JP1: "jp",
  TR1: "tr", RU: "ru", OC1: "oce"
};

function buildTrackerUrl(tracker, player) {
  const name = encodeURIComponent(player.account || player.gameName || "");
  const tag  = encodeURIComponent(player.tag || player.tagLine || "");
  const slug = platformSlug[player.platform] || "lan";

  switch (tracker) {
    case "opgg":
      return player.opggUrl || `https://op.gg/es/lol/summoners/${slug}/${name}-${tag}`;
    case "deeplol":
      return `https://www.deeplol.gg/summoner/${slug.toUpperCase()}/${name}-${tag}`;
    case "ugg": {
      const uggMap = {
        "Monster":     "https://u.gg/lol/profile/la1/m%C3%B3nster-lan/overview",
        "Zempai":      "https://u.gg/lol/profile/la1/zempai-115/overview",
        "Yoyi xRDx":  "https://u.gg/lol/profile/la1/yoyi-xrdx/overview",
        "Yoyi 0714":  "https://u.gg/lol/profile/la1/yoyi-0714/overview",
        "MonkeyD":     "https://u.gg/lol/profile/la1/m%C3%B3nkeyd-lan/overview",
        "ElMalvado12": "https://u.gg/lol/profile/la1/elmalv%C3%A1do12-7506/overview",
        "Teufel H":    "https://u.gg/lol/profile/la1/teufel%20h-lan/overview",
        "superjean09": "https://u.gg/lol/profile/la1/superjean09-lan/overview",
        "Jows":        "https://u.gg/lol/profile/la1/jows-rptm/overview",
      };
      return uggMap[player.name] || `https://u.gg/lol/profile/la1/${encodeURIComponent((player.account || "").toLowerCase())}-${encodeURIComponent((player.tag || "").toLowerCase())}/overview`;
    }
    case "blitz":
      return `https://blitz.gg/lol/profile/${player.platform}/${encodeURIComponent(player.account || "")}-${encodeURIComponent(player.tag || "")}`;
    case "log": {
      const logMap = {
        "Monster":     "https://www.leagueofgraphs.com/summoner/lan/M%C3%B3nster-LAN",
        "Jows":        "https://www.leagueofgraphs.com/summoner/lan/Jows-RpTM",
        "superjean09": "https://www.leagueofgraphs.com/summoner/lan/superjean09-LAN",
        "Teufel H":    "https://www.leagueofgraphs.com/summoner/lan/Teufel+H-LAN",
        "Zempai":      "https://www.leagueofgraphs.com/summoner/lan/Zempai-115",
        "ElMalvado12": "https://www.leagueofgraphs.com/summoner/lan/ElMalv%C3%A1do12-7506",
        "MonkeyD":     "https://www.leagueofgraphs.com/summoner/lan/M%C3%B3nkeyD-LAN",
        "Yoyi 0714":  "https://www.leagueofgraphs.com/summoner/lan/Yoyi-0714",
        "Yoyi xRDx":  "https://www.leagueofgraphs.com/summoner/lan/Yoyi-xRDx",
      };
      return logMap[player.name] || `https://www.leagueofgraphs.com/summoner/${slug}/${encodeURIComponent(player.account || "")}-${encodeURIComponent(player.tag || "")}`;
    }
    case "mobalytics":
      return `https://mobalytics.gg/lol/profile/${slug}/${encodeURIComponent((player.account || "").toLowerCase())}-${encodeURIComponent((player.tag || "").toLowerCase())}/overview`;
    default:
      return "#";
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const table = document.getElementById("player-table");
const legend = document.getElementById("chart-legend");
const refreshButton = document.getElementById("refresh-button");
const statusBanner = document.getElementById("status-banner");
const spotlightTabs = document.getElementById("spotlight-tabs");
const spotlightChips = document.getElementById("spotlight-chips");
const spotlightMatchesList = document.getElementById("spotlight-matches-list");
const spotlightLoadMore = document.getElementById("spotlight-load-more");
const chartCanvas = document.getElementById("lp-chart");
let chartResizeFrame = null;
let loadMoreState = { playerName: null, page: 1, tierColor: "#fff", loading: false };

const tierStyles = {
  challenger: {
    color: "#7bdcff",
    glow: "rgba(123, 220, 255, 0.35)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-challenger.png"
  },
  grandmaster: {
    color: "#ff7a7a",
    glow: "rgba(255, 122, 122, 0.32)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-grandmaster.png"
  },
  master: {
    color: "#c08cff",
    glow: "rgba(192, 140, 255, 0.34)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-master.png"
  },
  diamond: {
    color: "#7eb6ff",
    glow: "rgba(126, 182, 255, 0.34)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-diamond.png"
  },
  emerald: {
    color: "#45e4a8",
    glow: "rgba(69, 228, 168, 0.32)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-emerald.png"
  },
  platinum: {
    color: "#59d6dd",
    glow: "rgba(89, 214, 221, 0.30)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-platinum.png"
  },
  gold: {
    color: "#f3c55a",
    glow: "rgba(243, 197, 90, 0.28)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-gold.png"
  },
  silver: {
    color: "#c7d1db",
    glow: "rgba(199, 209, 219, 0.28)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-silver.png"
  },
  bronze: {
    color: "#c98a62",
    glow: "rgba(201, 138, 98, 0.28)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-bronze.png"
  },
  iron: {
    color: "#8d8f98",
    glow: "rgba(141, 143, 152, 0.26)",
    emblem: "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-iron.png"
  },
  unranked: { color: "#8f92a0", glow: "rgba(143, 146, 160, 0.22)", emblem: "" }
};

const tierOrder = {
  challenger: 10,
  grandmaster: 9,
  master: 8,
  diamond: 7,
  emerald: 6,
  platinum: 5,
  gold: 4,
  silver: 3,
  bronze: 2,
  iron: 1,
  unranked: 0
};

const divisionOrder = {
  I: 4,
  II: 3,
  III: 2,
  IV: 1
};

const chartTierSequence = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "emerald",
  "diamond",
  "master",
  "grandmaster",
  "challenger"
];

const chartTierBandColors = {
  iron: "rgba(77, 92, 118, 0.11)",
  bronze: "rgba(121, 83, 53, 0.11)",
  silver: "rgba(133, 150, 173, 0.11)",
  gold: "rgba(180, 154, 62, 0.12)",
  platinum: "rgba(69, 145, 142, 0.12)",
  emerald: "rgba(44, 140, 94, 0.12)",
  diamond: "rgba(63, 105, 187, 0.14)",
  master: "rgba(112, 68, 154, 0.14)",
  grandmaster: "rgba(152, 67, 67, 0.14)",
  challenger: "rgba(171, 150, 88, 0.14)"
};

function formatTimestamp(isoString) {
  if (!isoString) {
    return "Sin actualizar";
  }

  return new Date(isoString).toLocaleString("es-BO", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function setStatus(message, type = "info") {
  statusBanner.textContent = message;
  statusBanner.dataset.state = type;
}

function getTierKey(tier = "") {
  const normalized = String(tier).toLowerCase();

  if (normalized.includes("challenger")) return "challenger";
  if (normalized.includes("grandmaster")) return "grandmaster";
  if (normalized.includes("master")) return "master";
  if (normalized.includes("diamond")) return "diamond";
  if (normalized.includes("emerald")) return "emerald";
  if (normalized.includes("platinum")) return "platinum";
  if (normalized.includes("gold")) return "gold";
  if (normalized.includes("silver")) return "silver";
  if (normalized.includes("bronze")) return "bronze";
  if (normalized.includes("iron")) return "iron";

  return "unranked";
}

function getDivisionValue(tier = "") {
  const match = String(tier).toUpperCase().match(/\b(I|II|III|IV)\b/);
  return match ? (divisionOrder[match[1]] || 0) : 0;
}

function comparePlayersByRank(a, b) {
  const tierDiff = (tierOrder[getTierKey(b.tier)] || 0) - (tierOrder[getTierKey(a.tier)] || 0);

  if (tierDiff !== 0) {
    return tierDiff;
  }

  const divisionDiff = getDivisionValue(b.tier) - getDivisionValue(a.tier);

  if (divisionDiff !== 0) {
    return divisionDiff;
  }

  const lpDiff = (b.lp || 0) - (a.lp || 0);

  if (lpDiff !== 0) {
    return lpDiff;
  }

  const winsDiff = (b.wins || 0) - (a.wins || 0);

  if (winsDiff !== 0) {
    return winsDiff;
  }

  return String(a.name || "").localeCompare(String(b.name || ""), "es");
}

function getSortedPlayers() {
  return players.slice().sort(comparePlayersByRank);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDuration(minutes) {
  const safeMinutes = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatDurationFromSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return "Reciente";
  }

  const diffMs = Date.now() - Number(timestamp);

  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return "Reciente";
  }

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) {
    return `Hace ${Math.max(minutes, 1)}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Hace ${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

function getTierLabel(tierKey) {
  const labelsMap = {
    challenger: "Challenger",
    grandmaster: "GrandMaster",
    master: "Master",
    diamond: "Diamond",
    emerald: "Emerald",
    platinum: "Platinum",
    gold: "Gold",
    silver: "Silver",
    bronze: "Bronze",
    iron: "Iron",
    unranked: "Sin rango"
  };

  return labelsMap[tierKey] || "Sin rango";
}

function getTierShortLabel(tierKey) {
  const labelsMap = {
    challenger: "C",
    grandmaster: "GM",
    master: "M",
    diamond: "D",
    emerald: "E",
    platinum: "P",
    gold: "G",
    silver: "S",
    bronze: "B",
    iron: "I",
    unranked: "SR"
  };

  return labelsMap[tierKey] || "SR";
}

function getCompactTierText(tierText = "") {
  const tierKey = getTierKey(tierText);
  const divisionMatch = String(tierText).toUpperCase().match(/\b(I|II|III|IV)\b/);
  const shortTier = getTierShortLabel(tierKey);

  if (divisionMatch && !["master", "grandmaster", "challenger", "unranked"].includes(tierKey)) {
    return `${shortTier} ${divisionMatch[1]}`;
  }

  return shortTier;
}

function getTierScore(tier = "", lp = 0) {
  const tierKey = getTierKey(tier);
  const divisionValue = getDivisionValue(tier);
  const base = (tierOrder[tierKey] || 0) * 400;
  const divisionScore = divisionValue > 0 ? divisionValue * 100 : 0;
  return base + divisionScore + clamp(lp || 0, 0, 100);
}

function getChartRankScore(tier = "", lp = 0) {
  const tierKey = getTierKey(tier);
  const tierIndex = chartTierSequence.indexOf(tierKey);

  if (tierIndex === -1) {
    return 0;
  }

  const safeLp = clamp(lp || 0, 0, 100);

  if (["master", "grandmaster", "challenger"].includes(tierKey)) {
    return tierIndex + (safeLp / 100);
  }

  const divisionValue = getDivisionValue(tier);
  const divisionIndex = Math.max(divisionValue - 1, 0);
  const divisionProgress = (divisionIndex * 100) + safeLp;
  return tierIndex + (divisionProgress / 400);
}

function getChartSeriesScores(player) {
  const baseScore = getChartRankScore(player.tier, player.lp);
  const trend = Array.isArray(player.series) ? player.series : [];
  const lastValue = trend.length ? trend[trend.length - 1] : 0;

  if (!trend.length) {
    return [baseScore];
  }

  return trend.map((value) => baseScore + ((value - lastValue) * 0.09));
}

function getChartData(player) {
  const history = Array.isArray(player.history) ? player.history : [];

  if (history.length > 1) {
    return {
      scores: history.map((entry) => getChartRankScore(entry.tier, entry.lp)),
      labels: Array.isArray(player.labels) ? player.labels : [],
      isHistorical: true
    };
  }

  return {
    scores: getChartSeriesScores(player),
    labels: Array.isArray(player.labels) ? player.labels : [],
    isHistorical: false
  };
}

function getChartTierWindow(playersForChart) {
  const visibleScores = playersForChart.flatMap((entry) => (
    Array.isArray(entry?.chartData?.scores) ? entry.chartData.scores : getChartData(entry).scores
  ));
  const fallbackMin = chartTierSequence.indexOf("gold");
  const fallbackMax = chartTierSequence.indexOf("master");
  const minScore = visibleScores.length ? Math.min(...visibleScores) : fallbackMin;
  const maxScore = visibleScores.length ? Math.max(...visibleScores) : fallbackMax;

  return {
    minTierIndex: Math.max(0, Math.floor(minScore) - 1),
    maxTierIndex: Math.min(chartTierSequence.length - 1, Math.ceil(maxScore) + 1)
  };
}

function getEstimatedPerformance(player) {
  const totalGames = (player.wins || 0) + (player.losses || 0);
  const wr = player.wr || 0;
  const lp = player.lp || 0;
  const volatility = Array.isArray(player.series)
    ? player.series.reduce((sum, value) => sum + Math.abs(value), 0)
    : 0;

  const kills = clamp(((wr / 100) * 6.4) + (lp / 55) + 1.2, 1.6, 13.5);
  const deaths = clamp((5.9 - (wr / 40)) + (totalGames > 0 ? 0 : 1.2), 1.4, 7.8);
  const assists = clamp((kills * 1.25) + (volatility / 18), 2.4, 14.8);
  const kda = ((kills + assists) / Math.max(deaths, 1)).toFixed(2);
  const cs = clamp(4.8 + ((lp / 100) * 1.1) + (volatility / 50), 4.1, 8.9).toFixed(1);
  const duration = 23 + Math.round(volatility / 4) + Math.round((100 - wr) / 12);

  return {
    kills: kills.toFixed(1),
    deaths: deaths.toFixed(1),
    assists: assists.toFixed(1),
    kda,
    cs,
    duration: formatDuration(duration)
  };
}

function getPrimaryChampionCard(player) {
  if (player?.mostPlayedChampion?.iconUrl) {
    return player.mostPlayedChampion;
  }

  const fallbackChampion = (
    Array.isArray(player?.historicalChampionStats) && player.historicalChampionStats.length
      ? player.historicalChampionStats
      : (Array.isArray(player?.recentChampionStats) ? player.recentChampionStats : [])
  )
    .slice()
    .sort((a, b) => {
      const gamesDiff = (Number(b?.games) || ((Number(b?.wins) || 0) + (Number(b?.losses) || 0)))
        - (Number(a?.games) || ((Number(a?.wins) || 0) + (Number(a?.losses) || 0)));

      if (gamesDiff !== 0) {
        return gamesDiff;
      }

      return (Number(b?.wr) || 0) - (Number(a?.wr) || 0);
    })[0];

  return fallbackChampion || null;
}

function getSpotlightChampionStats(player) {
  if (Array.isArray(player?.historicalChampionStats) && player.historicalChampionStats.length) {
    return player.historicalChampionStats;
  }

  return Array.isArray(player?.recentChampionStats) ? player.recentChampionStats : [];
}

function getMatchLevelBadge(match) {
  return Number(match?.champLevel) > 0 ? String(match.champLevel) : "";
}

function renderSpotlightTabs() {
  const sortedPlayers = getSortedPlayers();
  spotlightTabs.innerHTML = "";

  if (!sortedPlayers.length) {
    return;
  }

  sortedPlayers.forEach((player, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spotlight-tab";
    button.textContent = player.name;
    button.dataset.active = index === activePlayerIndex ? "true" : "false";
    button.addEventListener("click", () => {
      activePlayerIndex = index;
      renderSpotlightTabs();
      renderSpotlightPanel();
    });
    spotlightTabs.appendChild(button);
  });
}

function renderSpotlightPanel() {
  const sortedPlayers = getSortedPlayers();
  const player = sortedPlayers[activePlayerIndex] || sortedPlayers[0];

  if (!player) {
    document.getElementById("spotlight-name").textContent = "Sin jugadores";
    spotlightMatchesList.innerHTML = "";
    return;
  }

  const totalGames = (player.wins || 0) + (player.losses || 0);
  const performance = getEstimatedPerformance(player);
  const tierKey = getTierKey(player.tier);
  const targetTierKey = getTierKey(currentTargetRank);
  const currentScore = getTierScore(player.tier, player.lp);
  const targetScore = Math.max(getTierScore(currentTargetRank, 0), currentScore + 100);
  const progress = clamp((currentScore / targetScore) * 100, 4, 100);

  const avatar = document.getElementById("spotlight-avatar");
  if (player.avatarUrl) {
    avatar.style.backgroundImage = `url("${player.avatarUrl}")`;
    avatar.textContent = "";
  } else {
    avatar.style.backgroundImage = `linear-gradient(135deg, ${player.color}, #f4ff90)`;
    avatar.textContent = player.name.slice(0, 2).toUpperCase();
  }
  avatar.style.backgroundSize = "cover";
  avatar.style.backgroundPosition = "center";

  document.getElementById("spotlight-name").textContent = player.name;
  document.getElementById("spotlight-games").textContent = totalGames;
  const wrValue = player.wr || 0;
  const wrEl = document.getElementById("spotlight-wr");
  wrEl.textContent = `${wrValue}%`;
  const wrColor = wrValue >= 50 ? "var(--green)" : "#ff5f7a";
  wrEl.style.color = wrColor;
  // also update the stat-accent container color
  const wrStat = wrEl.closest(".spotlight-stat-accent");
  if (wrStat) wrStat.style.setProperty("--wr-color", wrColor);
  document.getElementById("spotlight-record").innerHTML = `<span class="record-wins">${player.wins || 0}W</span><span class="record-separator"> / </span><span class="record-losses">${player.losses || 0}L</span>`;
  document.getElementById("spotlight-kda").textContent = performance.kda;
  document.getElementById("spotlight-kda-detail").textContent = `${performance.kills} / ${performance.deaths} / ${performance.assists}`;
  document.getElementById("spotlight-cs").textContent = performance.cs;
  document.getElementById("spotlight-duration").textContent = player.averageGameDurationSeconds
    ? formatDurationFromSeconds(player.averageGameDurationSeconds)
    : "—";
  const championCard = getPrimaryChampionCard(player);
  const championIcon = document.getElementById("spotlight-champion-icon");
  const championRecord = document.getElementById("spotlight-champion-record");

  if (championCard?.iconUrl) {
    championIcon.style.backgroundImage = `url("${championCard.iconUrl}")`;
    championIcon.classList.remove("empty");
  } else {
    championIcon.style.backgroundImage = "";
    championIcon.classList.add("empty");
  }

  championRecord.innerHTML = championCard
    ? `<span class="record-champ-name">${championCard.key}</span><span class="record-total">${championCard.wins}W-${championCard.losses}L</span> <strong style="color:${championCard.wr >= 50 ? 'var(--green)' : '#ff5f7a'}">${championCard.wr}%</strong>`
    : "Sin record";

  spotlightChips.innerHTML = "";
  getSpotlightChampionStats(player).slice(0, 3).forEach((chip) => {
    const item = document.createElement("div");
    item.className = "spotlight-chip";
    item.innerHTML = `
      <img class="spotlight-chip-icon" src="${chip.iconUrl}" alt="${chip.key}">
      <strong class="spotlight-chip-name">${chip.key}</strong>
      <span class="spotlight-chip-record">${chip.wins}-${chip.losses}</span>
      <strong class="spotlight-chip-wr ${chip.wr >= 50 ? "is-good" : "is-bad"}">${chip.wr}%</strong>
    `;
    spotlightChips.appendChild(item);
  });

  // ── Tier color ──────────────────────────────────────────────────
  const tierColor = (tierStyles[tierKey] || tierStyles.unranked).color;
  const tierGlow  = (tierStyles[tierKey] || tierStyles.unranked).glow;

  const progressFill  = document.getElementById("spotlight-progress-fill");
  const progressTrack = progressFill.parentElement;
  progressTrack.style.setProperty("--progress-color", `linear-gradient(90deg, ${tierColor}aa, ${tierColor})`);
  progressTrack.style.setProperty("--progress-glow", tierGlow);

  const progressHead = document.querySelector(".spotlight-progress-head");
  if (progressHead) progressHead.style.setProperty("--progress-accent", tierColor);

  // ── Next rank (objective = one tier above current) ───────────────
  const tierSequence = ["iron","bronze","silver","gold","platinum","emerald","diamond","master","grandmaster","challenger"];
  const currentTierIdx = tierSequence.indexOf(tierKey);
  const nextTierKey = currentTierIdx >= 0 && currentTierIdx < tierSequence.length - 1
    ? tierSequence[currentTierIdx + 1]
    : tierKey;
  const nextTierLabel = getTierLabel(nextTierKey);

  // ── Divisions within current tier ──────────────────────────────
  // Tiers with divisions: iron, bronze, silver, gold, platinum, emerald, diamond
  const tiersWithDivisions = ["iron","bronze","silver","gold","platinum","emerald","diamond"];
  const hasDivisions = tiersWithDivisions.includes(tierKey);

  // Current LP within current tier (0-399 across 4 divisions × 100 LP)
  // Division IV=0-99, III=100-199, II=200-299, I=300-399, next tier = 400
  const divMap = { IV: 0, III: 1, II: 2, I: 3 };
  const divMatch = String(player.tier || "").toUpperCase().match(/\b(I|II|III|IV)\b/);
  const divIdx = divMatch ? (divMap[divMatch[1]] ?? 0) : 0;
  const lpInTier = divIdx * 100 + clamp(player.lp || 0, 0, 100); // 0-399
  const totalLpInTier = 400; // 4 divisions × 100 LP
  const progressPct = clamp((lpInTier / totalLpInTier) * 100, 1, 99);

  // ── Update head label ───────────────────────────────────────────
  const tierLabelShort = getTierShortLabel(tierKey);
  document.getElementById("spotlight-progress-label").textContent = `${tierLabelShort} → ${getTierShortLabel(nextTierKey)}`;
  document.getElementById("spotlight-progress-lp").textContent = `${getCompactTierText(player.tier)} · ${player.lp || 0} LP`;
  document.getElementById("spotlight-progress-lp").style.color = tierColor;

  // ── Fill bar ────────────────────────────────────────────────────
  progressFill.style.width = `${progressPct}%`;

  // ── Remove old static markers, render dynamic ones ──────────────
  // Clear existing markers
  progressTrack.querySelectorAll(".spotlight-progress-marker").forEach(el => el.remove());

  if (hasDivisions) {
    // Division labels above bar + LP label below current position
    const divLabels = [
      { label: `${getTierShortLabel(tierKey)}4`, pct: 0 },
      { label: `${getTierShortLabel(tierKey)}3`, pct: 25 },
      { label: `${getTierShortLabel(tierKey)}2`, pct: 50 },
      { label: `${getTierShortLabel(tierKey)}1`, pct: 75 },
      { label: getTierShortLabel(nextTierKey) + (tiersWithDivisions.includes(nextTierKey) ? "4" : ""), pct: 100 },
    ];

    divLabels.forEach(({ label, pct }) => {
      const marker = document.createElement("span");
      marker.className = "spotlight-progress-marker spotlight-progress-div";
      marker.textContent = label;
      marker.style.left = pct === 0 ? "0" : pct === 100 ? "auto" : `${pct}%`;
      if (pct === 100) marker.style.right = "0";
      if (pct > 0 && pct < 100) marker.style.transform = "translateX(-50%)";
      progressTrack.appendChild(marker);
    });

    // Dot markers at each division boundary
    [0, 25, 50, 75, 100].forEach(pct => {
      const dot = document.createElement("span");
      dot.className = "spotlight-progress-dot";
      if (pct === 0) {
        dot.style.left = "0px";
        dot.style.marginLeft = "0";
      } else if (pct === 100) {
        dot.style.right = "0px";
        dot.style.left = "auto";
        dot.style.marginLeft = "0";
        dot.style.marginRight = "-4px";
      } else {
        dot.style.left = `${pct}%`;
      }
      progressTrack.appendChild(dot);
    });
  } else {
    // For master+ just show start/end
    const startEl = document.createElement("span");
    startEl.className = "spotlight-progress-marker spotlight-progress-start";
    startEl.textContent = getTierShortLabel(tierKey);
    progressTrack.appendChild(startEl);

    const endEl = document.createElement("span");
    endEl.className = "spotlight-progress-marker spotlight-progress-end";
    endEl.textContent = getTierShortLabel(nextTierKey);
    progressTrack.appendChild(endEl);
  }

  // LP label below bar at current position
  const lpLabel = document.createElement("span");
  lpLabel.className = "spotlight-progress-marker spotlight-progress-lp-label";
  lpLabel.textContent = `${player.lp || 0} LP`;
  lpLabel.style.left = `${clamp(progressPct, 2, 95)}%`;
  lpLabel.style.transform = "translateX(-50%)";
  lpLabel.style.color = tierColor;
  progressTrack.appendChild(lpLabel);

  renderSpotlightMatches(player, tierColor);
}

function renderSpotlightMatches(player, tierColor) {
  spotlightMatchesList.innerHTML = "";

  const matches = Array.isArray(player.recentMatches) ? player.recentMatches.slice(0, 5) : [];

  if (!matches.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "spotlight-match-empty";
    emptyState.textContent = "No hay suficientes partidas recientes para mostrar este bloque.";
    spotlightMatchesList.appendChild(emptyState);
    return;
  }

  matches.forEach((match) => {
    const row = document.createElement("article");
    row.className = `spotlight-match-row ${match.win ? "is-win" : "is-loss"}`;

    const hasCombatStats = [match.kills, match.deaths, match.assists].some((value) => Number(value) > 0);
    const kda = hasCombatStats
      ? `${match.kills || 0} / <span class="spotlight-kda-deaths">${match.deaths || 0}</span> / ${match.assists || 0}`
      : "KDA n/d";
    const csLabel = match.cs ? `${match.cs} CS` : "CS n/d";
    const durationLabel = match.gameDurationSeconds ? formatDurationFromSeconds(match.gameDurationSeconds) : "--:--";
    const summaryRecord = Number.isFinite(match.wins) || Number.isFinite(match.losses)
      ? `${match.wins || 0}-${match.losses || 0}${Number.isFinite(match.wr) ? ` ${match.wr}%` : ""}`
      : "";
    const levelLabel = summaryRecord || (match.champLevel ? `Nv. ${match.champLevel}` : "Sin nivel");
    const items = Array.isArray(match.itemIconUrls) ? match.itemIconUrls.slice(0, 7) : [];

    row.innerHTML = `
      <div class="spotlight-match-result">
        <span class="spotlight-match-time">${formatRelativeTime(match.gameEndTimestamp)}</span>
        <strong>${match.win ? "Victoria" : "Derrota"}</strong>
        <span>${durationLabel}</span>
      </div>
      <div class="spotlight-match-champion">
        <div class="spotlight-match-avatar ${match.championIconUrl ? "" : "empty"}" ${match.championIconUrl ? `style="background-image:url('${match.championIconUrl}')"` : ""}></div>
        <div class="spotlight-match-champion-meta">
          <strong>${match.championName || "Sin campeón"}</strong>
          <span>${levelLabel}</span>
        </div>
      </div>
      <div class="spotlight-match-score">
        <strong>${kda}</strong>
        <span>${csLabel}</span>
      </div>
      <div class="spotlight-match-items"></div>
    `;

    row.style.setProperty("--match-accent", tierColor);

    const itemsWrap = row.querySelector(".spotlight-match-items");
    if (items.length) {
      items.forEach((iconUrl) => {
        const item = document.createElement("img");
        item.className = "spotlight-match-item";
        item.src = iconUrl;
        item.alt = "Item";
        item.onerror = () => {
          item.remove();

          if (!itemsWrap.children.length) {
            const fallbackText = document.createElement("span");
            fallbackText.className = "spotlight-match-items-empty";
            fallbackText.textContent = "Sin items";
            itemsWrap.appendChild(fallbackText);
          }
        };
        itemsWrap.appendChild(item);
      });
    } else {
      const fallback = document.createElement("span");
      fallback.className = "spotlight-match-items-empty";
      fallback.textContent = "Sin items";
      itemsWrap.appendChild(fallback);
    }

    spotlightMatchesList.appendChild(row);
  });
}

function renderSpotlightMatches(player, tierColor) {
  spotlightMatchesList.innerHTML = "";
  spotlightLoadMore.hidden = true;

  loadMoreState = { playerName: player.name, page: 1, tierColor, loading: false };

  const allMatches = Array.isArray(player.recentMatches) ? player.recentMatches : [];
  const hasDetailedMatches = allMatches.some(
    (m) => m.role && m.role !== "Sin línea" || (m.alliedTeam?.length > 0 || m.enemyTeam?.length > 0)
  );
  const matches = (hasDetailedMatches
    ? allMatches.filter((m) => m.role !== "Sin línea" || m.alliedTeam?.length > 0 || m.enemyTeam?.length > 0)
    : allMatches
  ).slice(0, 5);

  if (!matches.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "spotlight-match-empty";
    emptyState.textContent = "No hay suficientes partidas recientes para mostrar este bloque.";
    spotlightMatchesList.appendChild(emptyState);
    spotlightLoadMore.hidden = false;
    return;
  }

  matches.forEach((match) => {
    const row = document.createElement("article");
    row.className = `spotlight-match-row ${match.win ? "is-win" : "is-loss"}`;

    const hasCombatStats = [match.kills, match.deaths, match.assists].some((value) => Number(value) > 0);
    const kda = hasCombatStats
      ? `${match.kills || 0} / <span class="spotlight-kda-deaths">${match.deaths || 0}</span> / ${match.assists || 0}`
      : "KDA n/d";
    const csLabel = match.cs ? `${match.cs} CS` : "CS n/d";
    const durationLabel = match.gameDurationSeconds ? formatDurationFromSeconds(match.gameDurationSeconds) : "--:--";
    const levelBadge = getMatchLevelBadge(match);
    const items = Array.isArray(match.itemIconUrls) ? match.itemIconUrls.slice(0, 7) : [];
    const paddedItems = [...items];
    const lpChangeLabel = match.lpChangeLabel || "?";

    while (paddedItems.length < 7) {
      paddedItems.push(null);
    }

    const teamsMarkup = (team) => (Array.isArray(team) ? team : []).slice(0, 5).map((member) => `
      <div class="spotlight-team-player">
        <span class="spotlight-team-player-icon ${member.championIconUrl ? "" : "empty"}" ${member.championIconUrl ? `style="background-image:url('${member.championIconUrl}')"` : ""}></span>
        <span class="spotlight-team-player-name">${escapeHtml(member.name || "Jugador")}</span>
      </div>
    `).join("");
    const itemsMarkup = paddedItems.map((iconUrl) => (
      iconUrl
        ? `<span class="spotlight-match-item-slot"><img class="spotlight-match-item" src="${iconUrl}" alt="Item"></span>`
        : `<span class="spotlight-match-item-slot is-empty" aria-hidden="true"></span>`
    )).join("");

    row.innerHTML = `
      <div class="spotlight-match-side">
        <span class="spotlight-match-time">${formatRelativeTime(match.gameEndTimestamp)}</span>
        <strong>${match.win ? "Victoria" : "Derrota"}</strong>
        <span>${durationLabel}</span>
      </div>
      <div class="spotlight-match-main">
        <div class="spotlight-match-player">
          <div class="spotlight-match-avatar-wrap">
            <div class="spotlight-match-avatar ${match.championIconUrl ? "" : "empty"}" ${match.championIconUrl ? `style="background-image:url('${match.championIconUrl}')"` : ""}></div>
            ${levelBadge ? `<span class="spotlight-match-level-badge">${levelBadge}</span>` : ""}
          </div>
          <div class="spotlight-match-player-meta">
            <strong>${escapeHtml(match.championName || "Sin campeón")}</strong>
            <span>${escapeHtml(match.role || "Sin línea")}</span>
          </div>
        </div>
        <div class="spotlight-match-score">
          <strong>${kda}</strong>
          <span>${csLabel}</span>
        </div>
        <div class="spotlight-match-meta">
          <strong class="spotlight-match-lp">${lpChangeLabel}</strong>
        </div>
        <div class="spotlight-match-items">${itemsMarkup}</div>
        <div class="spotlight-match-teams">
          <div class="spotlight-team-column">${teamsMarkup(match.alliedTeam)}</div>
          <div class="spotlight-team-column">${teamsMarkup(match.enemyTeam)}</div>
        </div>
      </div>
    `;

    row.style.setProperty("--match-accent", tierColor);
    spotlightMatchesList.appendChild(row);
  });
}

function renderPlayers() {
  const template = document.getElementById("player-row-template");
  table.innerHTML = "";
 
  getSortedPlayers().forEach((player, index) => {
      const node = template.content.cloneNode(true);
      const tierKey = getTierKey(player.tier);
      const tierStyle = tierStyles[tierKey];
      const totalGames = (player.wins || 0) + (player.losses || 0);

      node.querySelector(".position").textContent = index + 1;
      const avatar = node.querySelector(".avatar");
      node.querySelector(".avatar-wrap").dataset.player = player.name;

      if (player.avatarUrl) {
        avatar.style.backgroundImage = `url("${player.avatarUrl}")`;
        avatar.style.backgroundSize = "cover";
        avatar.style.backgroundPosition = "center";
        avatar.textContent = "";
      } else {
        avatar.textContent = player.name.slice(0, 2).toUpperCase();
        avatar.style.backgroundImage = `linear-gradient(135deg, ${player.color}, #f4ff90)`;
      }

      node.querySelector(".display-name").textContent = player.name;
      const normalizedRole = String(player.role || "").trim();
      const roleLabel = normalizedRole.toLowerCase() === "por definir" ? "" : normalizedRole;
      const identityMeta = [roleLabel].filter(Boolean).join(" - ");
      const roleNode = node.querySelector(".role");
      roleNode.textContent = identityMeta;
      roleNode.hidden = !identityMeta;

      const accountLink = node.querySelector(".account-name");
      accountLink.textContent = player.account;
      accountLink.href = buildTrackerUrl(activeTracker, player);
      accountLink.dataset.playerIdx = index;
      accountLink.target = "_blank";
      accountLink.rel = "noreferrer";
      node.querySelector(".tag-line").textContent = player.tag || "";

      const tierFullName = node.querySelector(".tier-full-name");
      const divMatch = String(player.tier || "").toUpperCase().match(/\b(I|II|III|IV)\b/);
      tierFullName.textContent = divMatch
        ? `${getTierLabel(tierKey)} ${divMatch[1]}`
        : getTierLabel(tierKey);
      tierFullName.style.color = tierStyle.color;

      const rankIcon = node.querySelector(".rank-icon");
      rankIcon.textContent = "";
      rankIcon.style.setProperty("--tier-color", tierStyle.color);
      rankIcon.style.setProperty("--tier-glow", tierStyle.glow);
      rankIcon.style.backgroundImage = tierStyle.emblem ? `url("${tierStyle.emblem}")` : "";
      rankIcon.classList.toggle("empty", !tierStyle.emblem);

      const lpLabel = player.lp > 0 || tierKey !== "unranked"
        ? `${player.lp} LP`
        : (player.sourceLabel || "Actualizado");
      node.querySelector(".lp").textContent = lpLabel;

      const record = node.querySelector(".record");
      record.classList.remove("positive", "negative", "neutral");

      if (totalGames === 0) {
        record.textContent = "Sin partidas";
        record.classList.add("neutral");
      } else {
        record.innerHTML = `<span class="record-wins">${player.wins}W</span> / <span class="record-losses">${player.losses}L</span>`;

        if (player.wins > player.losses) {
          record.classList.add("positive");
        } else if (player.losses > player.wins) {
          record.classList.add("negative");
        } else {
          record.classList.add("neutral");
        }
      }

      node.querySelector(".wr").textContent = totalGames > 0 ? `${player.wr}% WR` : "Sin WR";

      table.appendChild(node);
  });
}

function renderLegend() {
  legend.innerHTML = "";

  players.forEach((player) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${player.color};--dot-color:${player.color};box-shadow:0 0 7px 2px ${player.color}88"></span>${player.name}`;
    legend.appendChild(item);
  });
}

function renderSummary(targetRank) {
  const avgLp = players.length
    ? Math.round(players.reduce((sum, player) => sum + player.lp, 0) / players.length)
    : 0;

  const mostWins = players.length
    ? players.reduce((best, player) => (player.wins > best.wins ? player : best), players[0])
    : null;

  const mostGames = players.length
    ? players.reduce((best, player) => {
      const total = player.wins + player.losses;
      const bestTotal = best.wins + best.losses;
      return total > bestTotal ? player : best;
    }, players[0])
    : null;

  document.getElementById("summary-target").textContent = getCompactTierText(targetRank || "GrandMaster");
  document.getElementById("summary-average").textContent = `${avgLp} LP`;
  document.getElementById("summary-wins").textContent = mostWins ? `${mostWins.name} (${mostWins.wins})` : "-";
  document.getElementById("summary-games").textContent = mostGames ? `${mostGames.name} (${mostGames.wins + mostGames.losses})` : "-";
}

function resizeChartCanvas() {
  if (!chartCanvas) {
    return null;
  }

  const wrap = chartCanvas.parentElement;
  const rect = wrap?.getBoundingClientRect();
  const cssWidth = Math.max(Math.round(rect?.width || chartCanvas.clientWidth || 520), 280);
  const cssHeight = Math.max(Math.round(chartCanvas.clientHeight || cssWidth * 0.69), 240);
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);

  if (chartCanvas.width !== pixelWidth || chartCanvas.height !== pixelHeight) {
    chartCanvas.width = pixelWidth;
    chartCanvas.height = pixelHeight;
  }

  const ctx = chartCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return {
    ctx,
    width: cssWidth,
    height: cssHeight
  };
}

function drawChart() {
  const chart = resizeChartCanvas();

  if (!chart) {
    return;
  }

  const { ctx, width, height } = chart;
  const padding = { top: 16, right: 14, bottom: 36, left: 42 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const chartPlayers = players
    .map((player) => ({ player, chartData: getChartData(player) }))
    .filter(({ chartData }) => Array.isArray(chartData.scores) && chartData.scores.length > 0);
  const tierWindow = getChartTierWindow(chartPlayers);
  const minVisibleScore = tierWindow.minTierIndex;
  const maxVisibleScore = tierWindow.maxTierIndex + 1;
  const axisLabels = chartPlayers.reduce((best, entry) => (
    entry.chartData.labels.length > best.length ? entry.chartData.labels : best
  ), labels);

  function getX(index, length) {
    return padding.left + (innerWidth / Math.max(length - 1, 1)) * index;
  }

  function getY(score) {
    const normalized = (score - minVisibleScore) / Math.max(maxVisibleScore - minVisibleScore, 1);
    return height - padding.bottom - normalized * innerHeight;
  }

  function drawSmoothLine(points, color) {
    if (points.length === 0) {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const current = points[i];
      const midX = (prev.x + current.x) / 2;

      ctx.quadraticCurveTo(midX, prev.y, current.x, current.y);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function createAreaPath(points) {
    if (!points.length) {
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, height - padding.bottom);
    ctx.lineTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const current = points[i];
      const midX = (prev.x + current.x) / 2;

      ctx.quadraticCurveTo(midX, prev.y, current.x, current.y);
    }

    ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
    ctx.closePath();
  }

  ctx.clearRect(0, 0, width, height);

  const baseGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  baseGradient.addColorStop(0, "rgba(27, 27, 20, 0.86)");
  baseGradient.addColorStop(0.4, "rgba(28, 24, 36, 0.8)");
  baseGradient.addColorStop(0.72, "rgba(19, 22, 38, 0.86)");
  baseGradient.addColorStop(1, "rgba(12, 16, 27, 0.94)");
  ctx.fillStyle = baseGradient;
  ctx.fillRect(padding.left, padding.top, innerWidth, innerHeight);

  for (let tierIndex = tierWindow.minTierIndex; tierIndex <= tierWindow.maxTierIndex; tierIndex += 1) {
    const yTop = getY(tierIndex + 1);
    const yBottom = getY(tierIndex);
    const tierKey = chartTierSequence[tierIndex];

    ctx.fillStyle = chartTierBandColors[tierKey] || "rgba(255,255,255,0.05)";
    ctx.fillRect(padding.left, yTop, innerWidth, yBottom - yTop);
  }

  const diagonal = ctx.createLinearGradient(padding.left, padding.top, width - padding.right, height - padding.bottom);
  diagonal.addColorStop(0, "rgba(255, 255, 255, 0.07)");
  diagonal.addColorStop(0.3, "rgba(255, 255, 255, 0.018)");
  diagonal.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = diagonal;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left + innerWidth * 0.42, padding.top);
  ctx.lineTo(width - padding.right, height - padding.bottom - innerHeight * 0.18);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padding.left, padding.top, innerWidth, innerHeight);

  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.font = '11px "Space Grotesk", sans-serif';
  ctx.fillStyle = "rgba(255,255,255,0.48)";

  for (let tierIndex = tierWindow.minTierIndex; tierIndex <= tierWindow.maxTierIndex; tierIndex += 1) {
    const y = getY(tierIndex);
    const tierKey = chartTierSequence[tierIndex];
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.56)";
    ctx.fillText(getTierShortLabel(tierKey), 8, y - 4);
  }

  axisLabels.forEach((label, index) => {
    const x = getX(index, axisLabels.length);
    const shouldLabel =
      index === 0 ||
      index === axisLabels.length - 1 ||
      index === Math.floor((axisLabels.length - 1) / 2) ||
      index % Math.max(Math.floor(axisLabels.length / 4), 3) === 0;

    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.stroke();

    if (shouldLabel) {
      ctx.fillStyle = "rgba(255,255,255,0.54)";
      ctx.fillText(label, x - 14, height - 14);
    }
  });

  ctx.setLineDash([]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(padding.left, padding.top, innerWidth, innerHeight);
  ctx.clip();

  chartPlayers.forEach(({ player, chartData }) => {
    const points = chartData.scores.map((score, index) => ({
      x: getX(index, chartData.scores.length),
      y: getY(score)
    }));

    createAreaPath(points);
    const areaGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    areaGradient.addColorStop(0, `${player.color}22`);
    areaGradient.addColorStop(0.7, `${player.color}08`);
    areaGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = areaGradient;
    ctx.fill();

    drawSmoothLine(points, player.color);

    points.forEach((point) => {
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#eef5fb";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  ctx.restore();

  if (chartPlayers.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = '14px "Space Grotesk", sans-serif';
    ctx.fillText("Sin suficientes partidas ranked recientes", padding.left + 18, padding.top + 26);
  }
}

function scheduleChartRedraw() {
  if (chartResizeFrame !== null) {
    cancelAnimationFrame(chartResizeFrame);
  }

  chartResizeFrame = requestAnimationFrame(() => {
    chartResizeFrame = null;
    drawChart();
  });
}

function mergePlayersPreservingGoodData(previousPlayers, nextPlayers) {
  const previousByName = new Map((previousPlayers || []).map((player) => [player.name, player]));

  return (nextPlayers || []).map((player) => {
    const previous = previousByName.get(player.name);

    if (!previous) {
      return player;
    }

    const nextMatches = Array.isArray(player.recentMatches) ? player.recentMatches : [];
    const previousMatches = Array.isArray(previous.recentMatches) ? previous.recentMatches : [];
    const nextSeries = Array.isArray(player.series) ? player.series : [];
    const previousSeries = Array.isArray(previous.series) ? previous.series : [];
    const nextLabels = Array.isArray(player.labels) ? player.labels : [];
    const previousLabels = Array.isArray(previous.labels) ? previous.labels : [];
    const nextHistory = Array.isArray(player.history) ? player.history : [];
    const previousHistory = Array.isArray(previous.history) ? previous.history : [];

    return {
      ...player,
      history: nextHistory.length ? nextHistory : previousHistory,
      mostPlayedChampion: player.mostPlayedChampion || previous.mostPlayedChampion || null,
      historicalChampionStats: Array.isArray(player.historicalChampionStats) && player.historicalChampionStats.length
        ? player.historicalChampionStats
        : (Array.isArray(previous.historicalChampionStats) ? previous.historicalChampionStats : []),
      recentMatches: nextMatches.length ? nextMatches : previousMatches,
      recentChampionStats: Array.isArray(player.recentChampionStats) && player.recentChampionStats.length
        ? player.recentChampionStats
        : (Array.isArray(previous.recentChampionStats) ? previous.recentChampionStats : []),
      series: nextSeries.length ? nextSeries : previousSeries,
      labels: nextLabels.length ? nextLabels : previousLabels,
      lastChampion: player.lastChampion || previous.lastChampion || null,
      averageGameDurationSeconds: player.averageGameDurationSeconds || previous.averageGameDurationSeconds || 0,
      avatarUrl: player.avatarUrl || previous.avatarUrl || null
    };
  });
}

async function loadPlayers() {
  refreshButton.disabled = true;
  setStatus("Cargando cuentas del squad...", "loading");
  const previousPlayers = players.slice();
  const previousLabels = labels.slice();
  const previousTargetRank = currentTargetRank;

  try {
    const response = await fetch("/api/players", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No pude cargar los datos del board.");
    }

    const incomingPlayers = Array.isArray(payload.players) ? payload.players : [];
    players = mergePlayersPreservingGoodData(previousPlayers, incomingPlayers);
    labels = players.find((player) => player.labels?.length)?.labels || previousLabels;
    currentTargetRank = payload.target || "GrandMaster";
    activePlayerIndex = clamp(activePlayerIndex, 0, Math.max(players.length - 1, 0));

    renderPlayers();
    renderLegend();
    renderSummary(payload.target);
    drawChart();
    renderSpotlightTabs();
    renderSpotlightPanel();

    document.getElementById("last-updated").textContent = formatTimestamp(payload.fetchedAt);
    document.getElementById("queue-label").textContent = payload.queueLabel || "SoloQ";

    if (payload.errors?.length) {
      setStatus(`Actualizado con ${players.length} cuentas. Algunas fuentes fallaron: ${payload.errors.join(" | ")}`, "error");
    } else {
      setStatus(`Actualizado con ${players.length} cuentas reales.`, "success");
    }
  } catch (error) {
    players = previousPlayers;
    labels = previousLabels;
    currentTargetRank = previousTargetRank;

    if (players.length) {
      renderPlayers();
      renderLegend();
      renderSummary(currentTargetRank);
      drawChart();
      renderSpotlightTabs();
      renderSpotlightPanel();
    } else {
      table.innerHTML = "";
      legend.innerHTML = "";
      renderSummary("GrandMaster");
      drawChart();
      renderSpotlightTabs();
      renderSpotlightPanel();
      document.getElementById("last-updated").textContent = "Sin datos";
    }

    setStatus(error.message, "error");
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadPlayers);

if (chartCanvas) {
  if (typeof ResizeObserver !== "undefined") {
    const chartResizeObserver = new ResizeObserver(() => {
      scheduleChartRedraw();
    });

    chartResizeObserver.observe(chartCanvas.parentElement || chartCanvas);
  }

  window.addEventListener("resize", scheduleChartRedraw);
}

// Tracker selector
document.querySelectorAll(".tracker-chip").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tracker-chip").forEach(b => b.classList.remove("tracker-chip-active"));
    btn.classList.add("tracker-chip-active");
    activeTracker = btn.dataset.tracker;
    // Update all account links in the table
    document.querySelectorAll(".account-name[data-player-idx]").forEach(link => {
      const idx = parseInt(link.dataset.playerIdx, 10);
      const sorted = getSortedPlayers();
      if (sorted[idx]) link.href = buildTrackerUrl(activeTracker, sorted[idx]);
    });
  });
});

loadPlayers();

async function checkLiveStatus() {
  try {
    const res = await fetch("/api/live", { cache: "no-store" });
    if (!res.ok) return;
    const { liveStatus } = await res.json();
    document.querySelectorAll(".avatar-wrap[data-player]").forEach((wrap) => {
      const dot = wrap.querySelector(".live-dot");
      if (!dot) return;
      const inGame = liveStatus[wrap.dataset.player] === true;
      dot.hidden = !inGame;
    });
  } catch {
    // silently ignore network errors
  }
}

checkLiveStatus();
setInterval(checkLiveStatus, 60_000);
