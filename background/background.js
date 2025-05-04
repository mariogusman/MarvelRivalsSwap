(function(){
  const origLog = console.log.bind(console);
  console.log = (...args) => {
    const expanded = args.map(arg => {
      if (arg !== null && typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch(e) {
          return arg;
        }
      }
      return arg;
    });
    origLog(...expanded);
  };
})();

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

// --- Canonical Slug Mapping ---
const heroNameToSlug = {
  "bruce-banner": "hulk",
  // Add more mappings if needed
};

function normalizeSlug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getCanonicalSlug(rawNameOrSlug) {
  const slug = normalizeSlug(rawNameOrSlug);
  return heroNameToSlug[slug] || slug;
}

function titleize(slug) {
  if (!slug || typeof slug !== 'string') return '';
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function loadStaticData() {
  try {
    const [charsRes, tuRes, tcRes] = await Promise.all([
      fetch('../assets/characters_overview.json'),
      fetch('../assets/teamups.json'),
      fetch('../assets/team_comps.json')
    ]);

    if (!charsRes.ok || !tuRes.ok || !tcRes.ok) throw new Error('Static fetch failed');

    const rawChars = await charsRes.json();
    teamups = await tuRes.json();
    teamComps = await tcRes.json();

    // compute average comp win-rate
    avgCompWr = teamComps.reduce((sum, c) => sum + Number(c.win_rate), 0) / teamComps.length;

    // load charactersOverview and validSlugs
    Object.entries(rawChars).forEach(([slug, hero]) => {
      validSlugs.add(slug);
      charactersOverview[slug] = hero;
    });

    // Save charactersOverview to localStorage
    localStorage.setItem('characters_overview', JSON.stringify(charactersOverview));

    // load matchups per slug
    for (const slug of validSlugs) {
      try {
        const res = await fetch(`../assets/matchups/${slug}_matchups.json`);
        if (!res.ok) continue;
        const data = await res.json();
        matchups[slug] = {};

        if (Array.isArray(data)) {
          data.forEach(e => {
            const enemy = normalizeSlug(e.enemy_hero || e.enemyHero);
            matchups[slug][enemy] = Number(e.difference?.toString().replace('%','')) || 0;
          });
        } else if (data && typeof data === 'object') {
          Object.entries(data).forEach(([enemy, details]) => {
            matchups[slug][normalizeSlug(enemy)] = Number(details.winrate) || 50;
          });
        }
      } catch (err) {
        console.warn(`Error loading matchups for ${slug}`, err);
      }
    }

    console.log('Static data loaded');
  } catch (err) {
    console.error('loadStaticData error', err);
  }
}

function lookupWinRate(slug) {
  return Number(charactersOverview[slug]?.win_rate) || 50;
}

function avgVsEnemies(slug, enemyTeam) {
  const wrs = enemyTeam
    .map(e => matchups[slug]?.[e])
    .filter(v => typeof v === 'number');
  return wrs.length ? wrs.reduce((a, b) => a + b, 0) / wrs.length : 50;
}

const TEAMUP_ANCHORS = ["hela", "adam-warlock", "venom", "groot"];

function avgTeamupScore(slug, team) {
  let total = 0, count = 0;
  // pairs
  team.forEach(m => {
    teamups.forEach(item => {
      if (item.team.length === 2 && [slug, m].sort().join('|') === item.team.slice().sort().join('|')) {
        total += Number(item.win_rate);
        count++;
      }
    });
  });
  // trios with anchor logic
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const trio = [slug, team[i], team[j]].sort();
      teamups.forEach(item => {
        if (item.team.length === 3 && item.team.slice().sort().join('|') === trio.join('|')) {
          // Only apply bonus if anchor is present
          const anchor = TEAMUP_ANCHORS.find(a => item.team.includes(a));
          if (anchor && trio.includes(anchor)) {
            total += Number(item.win_rate);
            count++;
          }
        }
      });
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
  // Compute expected win rate for current hero
  const currentWinRate = computeExpectedWinRate(myHero, myTeam, enemyTeam);

  return Array.from(validSlugs)
    .filter(s => s !== myHero && !myTeam.includes(s))
    .map(slug => {
      // Simulate team with candidate
      const candidateTeam = [...myTeam.filter(h => h !== myHero), slug];
      const candidateWinRate = computeExpectedWinRate(slug, candidateTeam, enemyTeam);

      // Calculate stat breakdowns for display
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
  // 1. Average winrate vs enemy team
  const avgVs = avgVsEnemies(hero, enemyTeam);

  // 2. Team-up bonus (if any teammates)
  const teammates = myTeam.filter(m => m !== hero);
  let teamupBonus = null;
  if (teammates.length > 0) {
    const teamupRaw = avgTeamupScore(hero, teammates);
    teamupBonus = teamupRaw !== null ? teamupRaw : null;
  }

  // 3. Comp bonus: lookup winrate for new comp
  const compCounts = countRoles([...myTeam.filter(m => m !== hero), hero]);
  const compWinrate = lookupCompWinrate(compCounts);

  // 4. Combine: weighted average (customize weights as needed)
  // You can adjust these weights based on data or regression
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

// Lower debounce for faster updates, but not instant
const processRoster = debounce(() => {
  console.log('Processing roster:', rosterBuffer);
  const entries = Object.values(rosterBuffer);
  if (!entries.length) return;
  const local = entries.find(e => e.is_local);
  if (!local) return;
  const myHero = getCanonicalSlug(local.slug);
  const myTeam = unique(entries.filter(e => e.is_teammate || e.is_local).map(e => getCanonicalSlug(e.slug))).slice(0, 6);
  const enemyTeam = unique(entries.filter(e => !e.is_teammate && !e.is_local).map(e => getCanonicalSlug(e.slug))).slice(0, 6);

  // Save teams for overlay rendering (even if partial)
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

  // --- NEW: If only the local player is present, save placeholder ---
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
}, 100); // 100ms debounce

const ROSTER_ENTRY_TIMEOUT = 30000; // 30 seconds

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
    // Remove if not updated for 30s or marked stale for 30s
    if (
      now - entry.lastUpdate > ROSTER_ENTRY_TIMEOUT ||
      (entry.staleSince && now - entry.staleSince > ROSTER_ENTRY_TIMEOUT)
    ) {
      delete rosterBuffer[uid];
    }
  });
}

// --- Robust Roster Update Logic ---

function handleInfoUpdates(event) {
  const info = event.info?.match_info;
  if (!info) return;

  // Gather all roster_xx keys and parse them
  const rosterEntries = Object.entries(info)
    .filter(([k]) => k.startsWith('roster_'))
    .map(([k, v]) => {
      try { return JSON.parse(v); } catch { return null; }
    })
    .filter(Boolean);

  // If this is a full roster update (10+ players), clear buffer first
  if (rosterEntries.length >= 10) {
    rosterBuffer = {};
  }

  // Track UIDs seen in this update
  const seenUIDs = new Set();

  rosterEntries.forEach(data => {
    const uid = data.uid || data.name || data.character_id;
    if (!uid) return;
    seenUIDs.add(uid);

    // Canonical slug for all logic
    const canonicalSlug = getCanonicalSlug(data.character_name || data.name);

    // Only add if valid
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

  // Remove any UIDs from rosterBuffer not seen in this update (only if full update)
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

// Only soft-clear on match_start and match_end
function handleGameEvents(event) {
  if (!event || !event.events) return;
  for (const ev of event.events) {
    if (ev.name === 'match_start' || ev.name === 'match_end') {
      clearRosterBuffer(true); // Soft clear
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
      // Clear teams and set placeholder recs
      localStorage.setItem('latest_teams', JSON.stringify({
        your: { members: [], roles: { Vanguard: 0, Duelist: 0, Strategist: 0 } },
        enemy: { members: [], roles: { Vanguard: 0, Duelist: 0, Strategist: 0 } }
      }));
      saveRecommendations([{ placeholder: true }]);
      rosterBuffer = {};
      // Optionally, refresh overlay if open
      overwolf.windows.obtainDeclaredWindow('overlay', r => {
        if (r.status === 'success') {
          overwolf.windows.sendMessage(r.window.id, 'refresh_recs', {}, () => {});
        }
      });
      console.log('Scene changed to Lobby: recommendations reset to placeholder.');
    }
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
}

init();