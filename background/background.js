// Advanced Logging for debugging
// This will log all objects as pretty-printed JSON strings, which is useful for debugging
// but can be slow for large objects. Use with caution in production code.
// (function(){
//   const origLog = console.log.bind(console);
//   console.log = (...args) => {
//     const expanded = args.map(arg => {
//       if (arg !== null && typeof arg === 'object') {
//         try {
//           return JSON.stringify(arg, null, 2);
//         } catch(e) {
//           return arg;
//         }
//       }
//       return arg;
//     });
//     origLog(...expanded);
//   };
// })();

// background.js - implements full Python algorithm with weights and all sub-scores

// debounce helper
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Weights from original Python model
const W1 = 0.4; // avg vs enemies
const W2 = 0.2; // baseline win rate
const W3 = 0.15; // teamup synergy
const W4 = 0.25; // comp bonus
const W5 = 0.1; // enemy strength penalty

const settingsKey = 'latest_swaps';
let charactersOverview = {};
let matchups = {};
let validSlugs = new Set();
let rosterBuffer = {};
let teamups = [];
let teamComps = [];
let avgCompWr = 50;
let preprocessedTeamups = { pairs: new Map(), trios: new Map() }; // New variable for optimized lookups

const STATIC_DATA_BASE_URL = 'https://raw.githubusercontent.com/mariogusman/MarvelRivalsSwap/refs/heads/main/assets/'; // <<< IMPORTANT: REPLACE THIS
const LOCAL_ASSET_PATH = '../assets/';

async function fetchStaticFileWithFallback(filename, isCritical = true) {
  let data = null;
  try {
    const response = await fetch(`${STATIC_DATA_BASE_URL}${filename}?v=${Date.now()}`); // Cache bust with version
    if (!response.ok) {
      console.warn(`Remote fetch for ${filename} failed with status ${response.status}. Falling back to local.`);
      throw new Error(`Remote fetch failed: ${response.status}`);
    }
    data = await response.json();
    console.log(`Successfully fetched remote ${filename}`);
    return data;
  } catch (err) {
    console.warn(`Failed to fetch remote ${filename} (Error: ${err.message}). Attempting local fallback.`);
    try {
      const localResponse = await fetch(`${LOCAL_ASSET_PATH}${filename}`);
      if (!localResponse.ok) {
        console.error(`CRITICAL: Local fallback for ${filename} also failed with status ${localResponse.status}.`);
        throw new Error(`Local fallback failed: ${localResponse.status}`);
      }
      data = await localResponse.json();
      console.log(`Successfully loaded local fallback ${filename}`);
      return data;
    } catch (localErr) {
      console.error(`CRITICAL: Failed to load ${filename} from both remote and local. Error: ${localErr.message}`);
      if (isCritical) throw localErr; // Rethrow if critical, or return default/empty
      return {}; // Or appropriate default like [] for arrays
    }
  }
}

async function loadStaticData() {
  try {
    const rawCharsData = await fetchStaticFileWithFallback('characters_overview.json');
    const teamupsData = await fetchStaticFileWithFallback('teamups.json'); // This is the raw teamups array
    const teamCompsData = await fetchStaticFileWithFallback('team_comps.json');
    const matchupsData = await fetchStaticFileWithFallback('all_matchups.json');

    charactersOverview = rawCharsData;
    teamups = teamupsData; // Keep original raw teamups if needed elsewhere, or just use it for preprocessing
    teamComps = teamCompsData;
    matchups = matchupsData;
    
    validSlugs = new Set(Object.keys(charactersOverview));

    if (teamComps && teamComps.length > 0) {
      avgCompWr = teamComps.reduce((sum, c) => sum + Number(c.win_rate), 0) / teamComps.length;
    } else {
      avgCompWr = 50;
    }
    localStorage.setItem('characters_overview', JSON.stringify(charactersOverview));

    // Pre-process teamups for faster lookups
    preprocessedTeamups.pairs.clear();
    preprocessedTeamups.trios.clear();
    if (Array.isArray(teamups)) { // Ensure teamups is an array
      teamups.forEach(item => {
        if (item && Array.isArray(item.team) && typeof item.win_rate !== 'undefined') { // Basic validation
          const sortedTeamKey = item.team.slice().sort().join('|');
          if (item.team.length === 2) {
            preprocessedTeamups.pairs.set(sortedTeamKey, Number(item.win_rate));
          } else if (item.team.length === 3) {
            // For trios, store the win_rate and the original team for anchor checks
            preprocessedTeamups.trios.set(sortedTeamKey, { win_rate: Number(item.win_rate), original_team: item.team });
          }
        }
      });
    }
    console.log('Preprocessed teamups:', preprocessedTeamups.pairs.size, 'pairs,', preprocessedTeamups.trios.size, 'trios');

    console.log('Static data loaded (remote or local fallback).');
  } catch (err) {
    console.error('Major error in loadStaticData:', err);
    charactersOverview = charactersOverview || {};
    teamups = teamups || [];
    teamComps = teamComps || [];
    matchups = matchups || {};
    avgCompWr = avgCompWr || 50;
    validSlugs = validSlugs.size > 0 ? validSlugs : new Set();
  }
}

function lookupWinRate(slug) {
  return Number(charactersOverview[slug]?.win_rate) || 50;
}

function avgVsEnemies(slug, enemyTeam) {
  const heroMatchups = matchups[slug];
  if (!heroMatchups) return 50;

  const wrs = enemyTeam
    .map(e => {
      const matchupData = heroMatchups[e];
      return typeof matchupData?.winrate === 'number' ? matchupData.winrate : null;
    })
    .filter(v => v !== null);
  return wrs.length ? wrs.reduce((a, b) => a + b, 0) / wrs.length : 50;
}

const TEAMUP_ANCHORS = ["hela", "adam-warlock", "venom", "groot"];

function avgTeamupScore(slug, team) { // team here is an array of teammate slugs
  let total = 0, count = 0;

  // Pairs
  team.forEach(m => { // m is a teammate slug
    const pairKey = [slug, m].sort().join('|');
    if (preprocessedTeamups.pairs.has(pairKey)) {
      total += preprocessedTeamups.pairs.get(pairKey);
      count++;
    }
  });

  // Trios
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const teammate1 = team[i];
      const teammate2 = team[j];
      const trioMembers = [slug, teammate1, teammate2];
      const trioKey = trioMembers.slice().sort().join('|');

      if (preprocessedTeamups.trios.has(trioKey)) {
        const trioData = preprocessedTeamups.trios.get(trioKey);
        const definedTrioTeam = trioData.original_team;
        const anchorInDefinedTeam = TEAMUP_ANCHORS.find(a => definedTrioTeam.includes(a));

        if (anchorInDefinedTeam) {
          if (trioMembers.includes(anchorInDefinedTeam)) {
            total += trioData.win_rate;
            count++;
          }
        } else {
          total += trioData.win_rate;
          count++;
        }
      }
    }
  }
  return count ? total / count : null;
}

function countRoles(team) {
  const counts = { Vanguard: 0, Duelist: 0, Strategist: 0 };
  team.forEach(slug => {
    const canonical = getCanonicalSlug(slug);
    const role = charactersOverview[canonical]?.role;
    if (counts.hasOwnProperty(role)) counts[role]++;
  });
  return counts;
}

function lookupCompWinrate(counts) {
  const comp = teamComps.find(c =>
    c.vanguard == counts.Vanguard && c.duelist == counts.Duelist && c.strategist == counts.Strategist
  );
  return comp ? Number(comp.win_rate) : 50;
}

function computeEnemyStrength(enemyTeam) {
  if (!Array.isArray(enemyTeam) || enemyTeam.length === 0) return 0;
  const base = enemyTeam.reduce((sum, e) => sum + (lookupWinRate(e) - 50), 0) / enemyTeam.length;
  let synergy = 0;
  if (enemyTeam.length > 1) synergy = (avgTeamupScore(enemyTeam[0], enemyTeam) - 50) || 0;
  const roles = countRoles(enemyTeam);
  const compBonus = lookupCompWinrate(roles) - avgCompWr;
  return base + synergy + compBonus;
}

function computeRecommendations(myHero, myTeam, enemyTeam) {
  const currentWinRate = computeExpectedWinRate(myHero, myTeam, enemyTeam);

  return Array.from(validSlugs)
    .filter(s => s !== myHero && !myTeam.includes(s))
    .map(slug => {
      const candidateTeam = [...myTeam.filter(h => h !== myHero), slug];
      const candidateWinRate = computeExpectedWinRate(slug, candidateTeam, enemyTeam);

      const avg_vs = avgVsEnemies(slug, enemyTeam);
      const baseline = lookupWinRate(slug);
      const teammates = candidateTeam.filter(m => m !== slug);
      const synergyRaw = avgTeamupScore(slug, teammates);
      const compCounts = countRoles(candidateTeam);
      const compWinrate = lookupCompWinrate(compCounts);

      return {
        hero: slug,
        avg_win_rate: baseline,
        avg_vs_enemy: avg_vs,
        synergy: synergyRaw,
        comp_bonus: compWinrate,
        expected_win_rate: candidateWinRate,
        win_chance_increase: candidateWinRate - currentWinRate
      };
    })
    .sort((a, b) => b.win_chance_increase - a.win_chance_increase)
    .slice(0, 3);
}

function computeExpectedWinRate(hero, myTeam, enemyTeam) {
  const avgVs = avgVsEnemies(hero, enemyTeam);
  const teammates = myTeam.filter(m => m !== hero);
  let teamupBonus = null;
  if (teammates.length > 0) {
    const teamupRaw = avgTeamupScore(hero, teammates);
    teamupBonus = teamupRaw !== null ? teamupRaw : null;
  }
  const compCounts = countRoles([...myTeam.filter(m => m !== hero), hero]);
  const compWinrate = lookupCompWinrate(compCounts);

  const weights = { vs: 0.5, teamup: 0.2, comp: 0.3 };
  let total = 0, denom = 0;
  if (!isNaN(avgVs)) { total += weights.vs * avgVs; denom += weights.vs; }
  if (teamupBonus !== null && !isNaN(teamupBonus)) { total += weights.teamup * teamupBonus; denom += weights.teamup; }
  if (!isNaN(compWinrate)) { total += weights.comp * compWinrate; denom += weights.comp; }
  return denom > 0 ? total / denom : 50;
}

function saveRecommendations(recs) {
  localStorage.setItem(settingsKey, JSON.stringify(recs));
}

function unique(arr) {
  return Array.from(new Set(arr));
}

const processRoster = debounce(() => {
  console.log('Processing roster:', rosterBuffer);
  const entries = Object.values(rosterBuffer);
  if (!entries.length) return;
  const local = entries.find(e => e.is_local);
  if (!local) return;
  const myHero = getCanonicalSlug(local.slug);
  const myTeam = unique(entries.filter(e => e.is_teammate || e.is_local).map(e => getCanonicalSlug(e.slug))).slice(0, 6);
  const enemyTeam = unique(entries.filter(e => !e.is_teammate && !e.is_local).map(e => getCanonicalSlug(e.slug))).slice(0, 6);

  localStorage.setItem('latest_teams', JSON.stringify({
    your: {
      members: myTeam,
      roles: countRoles(myTeam)
    },
    enemy: {
      members: enemyTeam,
      roles: countRoles(enemyTeam)
    }
  }));

  if (myTeam.length <= 1 && enemyTeam.length === 0) {
    saveRecommendations([
      { placeholder: true }
    ]);
    return;
  }

  const recs = computeRecommendations(myHero, myTeam, enemyTeam);
  saveRecommendations(recs);

  console.log('Saved recs:', recs);
  console.log('Saved teams:', {
    your: {
      members: myTeam,
      roles: countRoles(myTeam)
    },
    enemy: {
      members: enemyTeam,
      roles: countRoles(enemyTeam)
    }
  });

  purgeStaleRosterEntries();
}, 100);

const ROSTER_ENTRY_TIMEOUT = 30000;

function clearRosterBuffer(soft = false) {
  if (soft) {
    Object.values(rosterBuffer).forEach(entry => {
      entry.staleSince = Date.now();
    });
    console.log('Roster buffer soft-cleared (marked stale) due to match event');
  } else {
    rosterBuffer = {};
    console.log('Roster buffer hard-cleared due to match event');
  }
}

function purgeStaleRosterEntries() {
  const now = Date.now();
  Object.keys(rosterBuffer).forEach(uid => {
    const entry = rosterBuffer[uid];
    if (
      now - entry.lastUpdate > ROSTER_ENTRY_TIMEOUT ||
      (entry.staleSince && now - entry.staleSince > ROSTER_ENTRY_TIMEOUT)
    ) {
      delete rosterBuffer[uid];
    }
  });
}

function handleInfoUpdates(event) {
  const info = event.info?.match_info;
  if (!info) return;

  const rosterEntries = Object.entries(info)
    .filter(([k]) => k.startsWith('roster_'))
    .map(([k, v]) => {
      try { return JSON.parse(v); } catch { return null; }
    })
    .filter(Boolean);

  if (rosterEntries.length >= 10) {
    rosterBuffer = {};
  }

  const seenUIDs = new Set();

  rosterEntries.forEach(data => {
    const uid = data.uid || data.name || data.character_id;
    if (!uid) return;
    seenUIDs.add(uid);

    const canonicalSlug = getCanonicalSlug(data.character_name || data.name);

    if (!validSlugs.has(canonicalSlug)) {
      console.warn('Unknown hero slug:', canonicalSlug, 'from', data.character_name || data.name);
      return;
    }

    rosterBuffer[uid] = {
      ...data,
      slug: canonicalSlug,
      lastUpdate: Date.now()
    };
  });

  if (rosterEntries.length >= 10) {
    Object.keys(rosterBuffer).forEach(uid => {
      if (!seenUIDs.has(uid)) {
        delete rosterBuffer[uid];
      }
    });
  }

  purgeStaleRosterEntries();
  processRoster();
}

function handleGameEvents(event) {
  if (!event || !event.events) return;
  for (const ev of event.events) {
    if (ev.name === 'match_start' || ev.name === 'match_end') {
      clearRosterBuffer(true);
    }
  }
}

let overlayAutoCloseTimer = null;

function toggleOverlay() {
  overwolf.windows.getWindowState('overlay', ({ window_state }) => {
    if (['closed', 'minimized', 'hidden'].includes(window_state)) {
      overwolf.windows.obtainDeclaredWindow('overlay', r => {
        if (r.status === 'success') {
          overwolf.windows.restore(r.window.id, () => {
            overwolf.windows.sendMessage(r.window.id, 'refresh_recs', { command: 'refresh_recs' }, () => {});
          });
        }
      });
    } else {
      overwolf.windows.close('overlay', () => {});
    }
  });
}

let lastScene = null;

function handleGameInfoScene(event) {
  const info = event.info?.game_info;
  if (!info || typeof info.scene !== 'string') return;

  if (info.scene !== lastScene) {
    lastScene = info.scene;
    if (info.scene === 'Lobby') {
      localStorage.setItem('latest_teams', JSON.stringify({
        your: { members: [], roles: { Vanguard: 0, Duelist: 0, Strategist: 0 } },
        enemy: { members: [], roles: { Vanguard: 0, Duelist: 0, Strategist: 0 } }
      }));
      saveRecommendations([{ placeholder: true }]);
      rosterBuffer = {};
      overwolf.windows.obtainDeclaredWindow('overlay', r => {
        if (r.status === 'success') {
          overwolf.windows.sendMessage(r.window.id, 'refresh_recs', {}, () => {});
        }
      });
      console.log('Scene changed to Lobby: recommendations reset to placeholder.');
    }
  }
}

async function showGameLaunchToastOnce() {
  if (!sessionStorage.getItem('bannerToastShown')) {
    overwolf.windows.obtainDeclaredWindow('toast', result => {
      if (result && result.window && result.window.id) {
        overwolf.windows.restore(result.window.id, () => {
          overwolf.windows.sendMessage(
            result.window.id,
            'show_game_launch_toast',
            { message: '▼ Press Alt+S during a match to view recommendations' },
            function() {}
          );
          setTimeout(() => {
            overwolf.windows.close(result.window.id, () => {});
          }, 6000);
          sessionStorage.setItem('bannerToastShown', '1');
        });
      }
    });
  }
}

async function init() {
  await loadStaticData();
  overwolf.games.events.onInfoUpdates2.addListener(handleInfoUpdates);
  overwolf.games.events.onInfoUpdates2.addListener(handleGameInfoScene);
  overwolf.games.events.onNewEvents.addListener(handleGameEvents);
  overwolf.settings.hotkeys.onPressed.addListener(h => {
    if (h.name === 'show_overlay') toggleOverlay();
  });
  overwolf.games.events.setRequiredFeatures(['match_info', 'death'], () => {});

  overwolf.games.getRunningGameInfo(function(info) {
    if (info && info.isRunning && info.classId === 24890) {
      showGameLaunchToastOnce();
    }
  });
}

init();