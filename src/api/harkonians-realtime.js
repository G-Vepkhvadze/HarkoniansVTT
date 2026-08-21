/**
 * HarkoniansVTT
 *
 * Supabase Realtime client for receiving live events from Harkonians.
 */

import { 
    getActorCredentials, 
    getWorldSecret, 
    clearActorCredentials 
} from "../state.js";
import { getRealtimeToken } from "./client.js";

// Supabase configuration
// These are public-safe credentials that can be bundled with the module
// The service role key (SUPABASE_SECRET_KEY) is only used server-side
const SUPABASE_URL = "https://your-project-ref.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "your-publishable-key";

/**
 * @type {import('@supabase/supabase-js').SupabaseClient|null}
 */
let supabase = null;

/**
 * @type {import('@supabase/supabase-js').RealtimeChannel|null}
 */
let channel = null;

/**
 * @type {NodeJS.Timeout|null}
 */
let tokenRefreshTimeout = null;

/**
 * @type {Function|null}
 */
let messageHandler = null;

/**
 * Initialize the Supabase client.
 */
function initSupabase() {
  if (supabase) {
    return;
  }
  
  // Dynamic import of supabase-js
  // This will be bundled by esbuild
  const { createClient } = require('@supabase/supabase-js');
  
  supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    realtime: {
      // Don't auto-connect - we'll manage this manually
      connectOnSubscribe: false
    }
  });
}

/**
 * Connect to Supabase Realtime.
 */
async function connectRealtime() {
  if (!supabase) {
    initSupabase();
  }
  
  // Already connected
  if (supabase && supabase.realtime.getSocket()?.isConnected()) {
    return;
  }
  
  // Connect
  supabase.realtime.connect();
  
  // Wait for connection
  await new Promise((resolve, reject) => {
    const checkConnection = () => {
      if (supabase.realtime.getSocket()?.isConnected()) {
        resolve();
      } else if (supabase.realtime.getSocket()?.isDisconnected()) {
        // If we're in a disconnected state, still resolve to avoid hanging
        resolve();
      } else {
        setTimeout(checkConnection, 100);
      }
    };
    
    // Set a timeout to avoid hanging forever
    setTimeout(() => {
      reject(new Error("Realtime connection timeout"));
    }, 10000);
    
    checkConnection();
  });
}

/**
 * Disconnect from Supabase Realtime.
 */
function disconnectRealtime() {
  if (tokenRefreshTimeout) {
    clearTimeout(tokenRefreshTimeout);
    tokenRefreshTimeout = null;
  }
  
  if (channel) {
    channel.unsubscribe();
    channel = null;
  }
  
  if (supabase) {
    supabase.realtime.disconnect();
  }
}

/**
 * Subscribe to character-specific channel.
 */
async function subscribeToCharacter() {
  const credentials = getActorCredentials();
  
  if (!credentials?.characterId) {
    console.log("HarkoniansVTT | No character ID available for subscription");
    return;
  }
  
  // Unsubscribe from existing channel
  if (channel) {
    channel.unsubscribe();
    channel = null;
  }
  
  // Get JWT token
  let tokenData;
  try {
    tokenData = await getRealtimeToken();
  } catch (error) {
    console.error("HarkoniansVTT | Failed to get realtime token:", error);
    return;
  }
  
  // Set auth
  supabase.realtime.setAuth(tokenData.token);
  
  // Subscribe to private channel
  const characterId = credentials.characterId;
  const topic = `foundry:character:${characterId}`;
  
  channel = supabase.channel(topic, {
    config: {
      private: true
    }
  });
  
  // Set up message handler
  channel.on(
    "broadcast",
    { event: /.*/ },
    (payload) => {
      if (messageHandler) {
        try {
          messageHandler(payload.event, payload.payload);
        } catch (error) {
          console.error("HarkoniansVTT | Error in message handler:", error);
        }
      }
    }
  );
  
  // Subscribe
  await new Promise((resolve, reject) => {
    const subscription = channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        console.log("HarkoniansVTT | Subscribed to character channel:", characterId);
        
        // Schedule token refresh
        scheduleTokenRefresh(tokenData.expiresAt);
        
        resolve();
      } else if (status === "CHANNEL_ERROR") {
        console.error("HarkoniansVTT | Channel subscription error:", err);
        // Retry
        setTimeout(() => {
          subscribeToCharacter().catch(console.error);
        }, 5000);
        reject(err || new Error("Channel subscription error"));
      }
    });
    
    // Set timeout
    setTimeout(() => {
      reject(new Error("Subscription timeout"));
    }, 10000);
  });
}

/**
 * Schedule JWT token refresh.
 * 
 * @param {number} expiresAt - Unix timestamp when token expires
 */
function scheduleTokenRefresh(expiresAt) {
  if (tokenRefreshTimeout) {
    clearTimeout(tokenRefreshTimeout);
  }
  
  // Refresh 30 seconds before expiry
  const refreshAt = expiresAt * 1000 - 30000;
  const now = Date.now();
  const delay = refreshAt - now;
  
  if (delay <= 0) {
    // Already expired or about to expire
    refreshToken();
    return;
  }
  
  console.log("HarkoniansVTT | Scheduling token refresh in", delay, "ms");
  tokenRefreshTimeout = setTimeout(refreshToken, delay);
}

/**
 * Refresh the JWT token.
 */
async function refreshToken() {
  try {
    const tokenData = await getRealtimeToken();
    supabase.realtime.setAuth(tokenData.token);
    scheduleTokenRefresh(tokenData.expiresAt);
    console.log("HarkoniansVTT | Realtime token refreshed");
  } catch (error) {
    console.error("HarkoniansVTT | Failed to refresh realtime token:", error);
    // Retry in 30 seconds
    tokenRefreshTimeout = setTimeout(refreshToken, 30000);
  }
}

/**
 * Set the message handler callback.
 * 
 * @param {Function} handler - Function(event, payload)
 */
export function onMessage(handler) {
  messageHandler = handler;
}

/**
 * Connect and subscribe to realtime events.
 * 
 * @returns {Promise<void>}
 */
export async function connect() {
  try {
    const worldSecret = getWorldSecret();
    const credentials = getActorCredentials();
    
    // Need both world and character to connect
    if (!worldSecret || !credentials?.characterId) {
      console.log("HarkoniansVTT | Cannot connect to realtime: missing world secret or character ID");
      return;
    }
    
    initSupabase();
    await connectRealtime();
    await subscribeToCharacter();
    
    console.log("HarkoniansVTT | Realtime connected and subscribed");
  } catch (error) {
    console.error("HarkoniansVTT | Realtime connection failed:", error);
    throw error;
  }
}

/**
 * Disconnect from realtime events.
 */
export function disconnect() {
  disconnectRealtime();
  console.log("HarkoniansVTT | Realtime disconnected");
}

/**
 * Reconnect if disconnected.
 */
export async function reconnect() {
  if (!supabase) {
    await connect();
    return;
  }
  
  if (!supabase.realtime.getSocket()?.isConnected()) {
    await connect();
  }
}

/**
 * Check if realtime is connected.
 * 
 * @returns {boolean}
 */
export function isConnected() {
  return supabase?.realtime.getSocket()?.isConnected() || false;
}

/**
 * Get the current channel topic.
 * 
 * @returns {string|null}
 */
export function getChannelTopic() {
  return channel?.topic || null;
}
