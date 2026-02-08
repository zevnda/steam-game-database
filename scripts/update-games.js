const fs = require('fs');
const path = require('path');

const GAMES_FILE = path.join(__dirname, '..', 'games.json');
const METADATA_FILE = path.join(__dirname, '..', 'metadata.json');
const API_KEY = process.env.STEAM_API_KEY;

if (!API_KEY) {
  console.error('ERROR: STEAM_API_KEY environment variable is not set');
  process.exit(1);
}

// Load existing games data
function loadGamesData() {
  try {
    if (!fs.existsSync(GAMES_FILE)) {
      console.log('No existing games data found. Starting fresh.');
      return [];
    }
    
    const rawData = fs.readFileSync(GAMES_FILE, 'utf8');
    const cleanData = rawData.replace(/^\uFEFF/, '');
    
    if (!cleanData.trim()) {
      console.log('Games file is empty. Starting fresh.');
      return [];
    }
    
    const parsed = JSON.parse(cleanData);
    
    // Validate that it's an array
    if (!Array.isArray(parsed)) {
      console.warn('Games data is not an array. Starting fresh.');
      return [];
    }
    
    return parsed;
  } catch (error) {
    console.error('Error loading games data:', error.message);
    console.log('Creating backup of corrupted file...');
    
    // Backup corrupted file
    const backupFile = GAMES_FILE.replace('.json', `.backup.${Date.now()}.json`);
    if (fs.existsSync(GAMES_FILE)) {
      fs.copyFileSync(GAMES_FILE, backupFile);
      console.log(`Backup created: ${backupFile}`);
    }
    
    console.log('Starting with empty database.');
    return [];
  }
}

// Load metadata
function loadMetadata() {
  if (fs.existsSync(METADATA_FILE)) {
    const data = fs.readFileSync(METADATA_FILE, 'utf8');
    return JSON.parse(data);
  }
  return {
    lastFetchTimestamp: 0,
    lastUpdateDate: null,
    totalGames: 0
  };
}

// Save games data to file
function saveGamesData(games) {
  fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2), 'utf8');
  console.log(`Saved ${games.length} games to ${GAMES_FILE}`);
}

// Save metadata to file
function saveMetadata(metadata) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf8');
  console.log(`Updated metadata: ${JSON.stringify(metadata, null, 2)}`);
}

async function fetchAllApps(ifModifiedSince) {
  const allApps = [];
  let lastAppId = 0;
  let pageCount = 0;
  let hasMore = true;

  console.log(`Starting fetch${ifModifiedSince ? ` with if_modified_since=${ifModifiedSince}` : ''}...`);

  while (hasMore) {
    pageCount++;
    
    const params = new URLSearchParams({
      key: API_KEY,
      max_results: 50000,
      include_dlc: false,
      include_software: false,
      include_videos: false,
      include_hardware: false
    });

    if (lastAppId > 0) {
      params.append('last_appid', lastAppId);
    }

    if (ifModifiedSince > 0) {
      params.append('if_modified_since', ifModifiedSince);
    }

    const url = `https://api.steampowered.com/IStoreService/GetAppList/v1/?${params.toString()}`;
    
    console.log(`Fetching page ${pageCount} (last_appid: ${lastAppId})...`);

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const responseData = data.response;

      if (responseData.apps && responseData.apps.length > 0) {
        allApps.push(...responseData.apps);
        console.log(`  Received ${responseData.apps.length} apps`);
      }

      hasMore = responseData.have_more_results || false;
      lastAppId = responseData.last_appid || 0;

      // Avoid rate limnits
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      console.error(`Error fetching page ${pageCount}:`, error.message);
      throw error;
    }
  }

  console.log(`Fetch complete. Total apps received: ${allApps.length}`);
  return allApps;
}

// Merge new datas into existing
function mergeApps(existingGames, newApps) {
  const existingSet = new Set(existingGames);
  let addedCount = 0;

  for (const app of newApps) {
    if (!existingSet.has(app.appid)) {
      existingGames.push(app.appid);
      existingSet.add(app.appid);
      addedCount++;
    }
  }

  existingGames.sort((a, b) => a - b);

  console.log(`Merge complete. Added: ${addedCount} new games`);
  return { addedCount };
}

async function updateGamesDatabase() {
  console.log('=== Steam Games Database Update ===');
  console.log(`Start time: ${new Date().toISOString()}`);

  try {
    // Load existing data
    const games = loadGamesData();
    const metadata = loadMetadata();

    console.log(`Existing games count: ${games.length}`);
    console.log(`Last fetch timestamp: ${metadata.lastFetchTimestamp}`);

    // Fetch new/updated apps
    const newApps = await fetchAllApps(metadata.lastFetchTimestamp);

    if (newApps.length === 0) {
      console.log('No new or updated apps found.');
    } else {
      // Merge apps
      const { addedCount } = mergeApps(games, newApps);

      saveGamesData(games);

      // Update metadata
      metadata.lastFetchTimestamp = Math.floor(Date.now() / 1000);
      metadata.lastUpdateDate = new Date().toISOString();
      metadata.totalGames = games.length;
      metadata.lastRunStats = {
        appsReceived: newApps.length,
        gamesAdded: addedCount
      };

      saveMetadata(metadata);
    }

    console.log('=== Update Complete ===');
    console.log(`End time: ${new Date().toISOString()}`);

  } catch (error) {
    console.error('=== Update Failed ===');
    console.error(error);
    process.exit(1);
  }
}

updateGamesDatabase();
