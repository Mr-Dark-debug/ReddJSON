/**
 * ReddJSON Background Service Worker v2.0
 * ═══════════════════════════════════════════════════════════════════
 * Handles:
 *   1. Reddit .json API fetching
 *   2. AI provider calls (OpenRouter, Groq — OpenAI-compatible)
 *   3. chrome.storage.local for history, AI posts, settings
 *   4. Side panel management (open on action click, Reddit-only)
 *
 * @fileoverview Service worker — the brain of ReddJSON
 * @version 2.0.0
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_HISTORY_ENTRIES = 50;
const MAX_AI_POSTS = 50;
const USER_AGENT = 'ReddJSON/2.0.0 (Chrome Extension)';

/** Default system prompt for LinkedIn post generation */
const DEFAULT_SYSTEM_PROMPT = `You are a world-class LinkedIn content strategist and viral post creator with 10+ years of experience generating posts that regularly hit 100k–1M+ impressions.

Your mission: Transform the entire Reddit thread (full JSON data) into ONE highly engaging, professional LinkedIn post in "staircase format" (numbered or bulleted ladder style that feels like a story and keeps people scrolling).

Rules (NEVER break these):
1. Start with a SCROLL-STOPPING hook in the first 1–2 lines (bold question, shocking stat, bold claim, or relatable pain point).
2. Use simple plain text only — no Markdown, no emojis overload, no "AI-generated" fluff. Use line breaks, — dashes, → arrows, and 1-2-3 numbering for the staircase.
3. Make it extremely valuable and actionable — people should think "this is gold, I'm saving/sharing this".
4. End with a strong CTA (comment your thoughts, tag a friend, save for later, or DM me).
5. Tone: Professional yet human, confident, insightful, humours, quirky, sarcastic, 23 years old— never salesy.
6. Length: 300–650 words (perfect LinkedIn sweet spot).
7. If the Reddit post has images, videos, or media, mention at the end: "Attach this visual: [image URL]" so the user knows exactly what to upload.

Here is the full Reddit thread JSON:`;

// Provider configurations 
const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Mr-Dark-debug/ReddJSON',
      'X-Title': 'ReddJSON'
    })
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsEndpoint: '/models',
    chatEndpoint: '/chat/completions',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  }
};

// ============================================================================
// SIDE PANEL — OPEN ON ICON CLICK
// ============================================================================

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(err => console.warn('[ReddJSON] setPanelBehavior error:', err));

// ============================================================================
// REDDIT JSON FETCHING
// ============================================================================

async function fetchRedditJSON(permalink) {
  try {
    let normalizedPath = permalink.startsWith('/') ? permalink : '/' + permalink;
    normalizedPath = normalizedPath.replace(/\/+$/, '');
    const jsonUrl = `https://www.reddit.com${normalizedPath}.json`;

    console.log('[ReddJSON] Fetching:', jsonUrl);

    const response = await fetch(jsonUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
      credentials: 'omit'
    });

    if (!response.ok) {
      const errorMap = {
        403: 'Private or quarantined subreddit — access denied',
        404: 'Post not found or deleted',
        429: 'Rate limited — please wait a moment',
        500: 'Reddit server error',
        502: 'Reddit temporarily unreachable',
        503: 'Reddit under heavy load',
      };
      return { success: false, error: errorMap[response.status] || `HTTP error ${response.status}` };
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { success: false, error: 'Unexpected JSON structure from Reddit' };
    }

    return { success: true, data };
  } catch (error) {
    console.error('[ReddJSON] Fetch error:', error);
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      return { success: false, error: 'Network error — check your connection' };
    }
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// ============================================================================
// AI PROVIDER — FETCH MODELS
// ============================================================================

async function fetchModels(providerId, apiKey) {
  try {
    const provider = PROVIDERS[providerId];
    if (!provider) return { success: false, error: `Unknown provider: ${providerId}` };
    if (!apiKey) return { success: false, error: 'API key is required' };

    const url = `${provider.baseUrl}${provider.modelsEndpoint}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: provider.headers(apiKey)
    });

    if (!response.ok) {
      if (response.status === 401) return { success: false, error: 'Invalid API key' };
      if (response.status === 429) return { success: false, error: 'Rate limited — try again' };
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    // Normalize model list
    let models = [];
    if (providerId === 'openrouter') {
      models = (data.data || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length || 0,
        isFree: (m.pricing?.prompt === '0' && m.pricing?.completion === '0') ||
          (parseFloat(m.pricing?.prompt || '1') === 0 && parseFloat(m.pricing?.completion || '1') === 0),
        pricing: m.pricing || {},
        description: m.description || '',
        provider: 'openrouter'
      }));
    } else if (providerId === 'groq') {
      models = (data.data || []).map(m => ({
        id: m.id,
        name: m.id,
        contextLength: m.context_window || 0,
        isFree: false, // Groq has free tier but model-level info isn't in /models
        pricing: {},
        description: m.owned_by || '',
        provider: 'groq'
      }));
    }

    return { success: true, models };
  } catch (error) {
    console.error('[ReddJSON] Fetch models error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// AI PROVIDER — CHAT COMPLETION
// ============================================================================

async function generateAIPost(providerId, apiKey, modelId, systemPrompt, redditJson) {
  try {
    const provider = PROVIDERS[providerId];
    if (!provider) return { success: false, error: `Unknown provider: ${providerId}` };
    if (!apiKey) return { success: false, error: 'API key is required' };
    if (!modelId) return { success: false, error: 'Model is required' };

    const url = `${provider.baseUrl}${provider.chatEndpoint}`;
    const jsonStr = typeof redditJson === 'string' ? redditJson : JSON.stringify(redditJson, null, 2);

    const body = {
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: jsonStr }
      ],
      temperature: 0.7,
      max_tokens: 2048
    };

    console.log('[ReddJSON] AI request to:', url, 'model:', modelId);

    const response = await fetch(url, {
      method: 'POST',
      headers: provider.headers(apiKey),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[ReddJSON] AI error body:', errBody);
      if (response.status === 401) return { success: false, error: 'Invalid API key' };
      if (response.status === 429) return { success: false, error: 'Rate limited — wait and retry' };
      if (response.status === 402) return { success: false, error: 'Insufficient credits' };
      try {
        const errJson = JSON.parse(errBody);
        return { success: false, error: errJson.error?.message || `HTTP ${response.status}` };
      } catch {
        return { success: false, error: `HTTP ${response.status}` };
      }
    }

    const data = await response.json();
    const generatedText = data.choices?.[0]?.message?.content;

    if (!generatedText) {
      return { success: false, error: 'No content in AI response' };
    }

    return {
      success: true,
      text: generatedText,
      usage: data.usage || {},
      model: data.model || modelId
    };
  } catch (error) {
    console.error('[ReddJSON] AI generation error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// MEDIA EXTRACTION FROM REDDIT JSON
// ============================================================================

function extractMediaFromRedditJson(jsonData) {
  try {
    const post = jsonData?.[0]?.data?.children?.[0]?.data;
    if (!post) return [];

    const media = [];

    // Direct image URL
    if (post.url && /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(post.url)) {
      media.push({ type: 'image', url: post.url });
    }

    // Reddit preview images
    if (post.preview?.images?.[0]?.source?.url) {
      const previewUrl = post.preview.images[0].source.url.replace(/&amp;/g, '&');
      media.push({ type: 'preview', url: previewUrl });
    }

    // Gallery images
    if (post.is_gallery && post.media_metadata) {
      for (const [, meta] of Object.entries(post.media_metadata)) {
        if (meta.s?.u) {
          media.push({ type: 'gallery', url: meta.s.u.replace(/&amp;/g, '&') });
        }
      }
    }

    // Reddit video
    if (post.is_video && post.media?.reddit_video?.fallback_url) {
      media.push({ type: 'video', url: post.media.reddit_video.fallback_url });
    }

    // External media
    if (post.media?.oembed?.thumbnail_url) {
      media.push({ type: 'thumbnail', url: post.media.oembed.thumbnail_url });
    }

    // Thumbnail
    if (post.thumbnail && post.thumbnail !== 'self' && post.thumbnail !== 'default' && post.thumbnail !== 'nsfw') {
      media.push({ type: 'thumbnail', url: post.thumbnail });
    }

    return media;
  } catch (e) {
    console.warn('[ReddJSON] Media extraction error:', e);
    return [];
  }
}

// ============================================================================
// STORAGE — JSON COPY HISTORY
// ============================================================================

async function addToHistory(entry) {
  try {
    const result = await chrome.storage.local.get(['reddjson_history']);
    let history = result.reddjson_history || [];

    const jsonString = JSON.stringify(entry.jsonData, null, 2);
    const jsonPreview = jsonString.substring(0, 300) + (jsonString.length > 300 ? '…' : '');

    const historyEntry = {
      id: `reddjson_${Date.now()}_${entry.postId}`,
      permalink: entry.permalink,
      title: entry.title || 'Untitled Post',
      subreddit: entry.subreddit || 'unknown',
      postId: entry.postId || 'unknown',
      jsonPreview,
      fullJson: entry.jsonData,
      timestamp: Date.now(),
      copiedCount: 1
    };

    const existingIndex = history.findIndex(h => h.postId === entry.postId);
    if (existingIndex !== -1) {
      const existing = history.splice(existingIndex, 1)[0];
      existing.timestamp = Date.now();
      existing.copiedCount = (existing.copiedCount || 1) + 1;
      existing.jsonPreview = jsonPreview;
      existing.fullJson = entry.jsonData;
      history.unshift(existing);
    } else {
      history.unshift(historyEntry);
    }

    if (history.length > MAX_HISTORY_ENTRIES) {
      history = history.slice(0, MAX_HISTORY_ENTRIES);
    }

    await chrome.storage.local.set({ reddjson_history: history });
    return { success: true, entry: historyEntry };
  } catch (error) {
    console.error('[ReddJSON] Storage error:', error);
    return { success: false, error: error.message };
  }
}

async function getHistory() {
  try {
    const result = await chrome.storage.local.get(['reddjson_history']);
    return { success: true, history: result.reddjson_history || [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function deleteHistoryEntry(entryId) {
  try {
    const result = await chrome.storage.local.get(['reddjson_history']);
    let history = result.reddjson_history || [];
    history = history.filter(e => e.id !== entryId);
    await chrome.storage.local.set({ reddjson_history: history });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function clearHistory() {
  try {
    await chrome.storage.local.set({ reddjson_history: [] });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getHistoryEntry(entryId) {
  try {
    const result = await chrome.storage.local.get(['reddjson_history']);
    const history = result.reddjson_history || [];
    const entry = history.find(e => e.id === entryId);
    return entry ? { success: true, entry } : { success: false, error: 'Not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// STORAGE — AI POSTS HISTORY
// ============================================================================

async function addAIPost(postEntry) {
  try {
    const result = await chrome.storage.local.get(['reddjson_ai_posts']);
    let posts = result.reddjson_ai_posts || [];

    const entry = {
      id: `aipost_${Date.now()}_${postEntry.postId || 'unknown'}`,
      permalink: postEntry.permalink,
      redditTitle: postEntry.redditTitle || 'Untitled',
      subreddit: postEntry.subreddit || 'unknown',
      generatedText: postEntry.generatedText,
      model: postEntry.model || 'unknown',
      provider: postEntry.provider || 'unknown',
      media: postEntry.media || [],
      timestamp: Date.now(),
      usage: postEntry.usage || {}
    };

    posts.unshift(entry);
    if (posts.length > MAX_AI_POSTS) posts = posts.slice(0, MAX_AI_POSTS);

    await chrome.storage.local.set({ reddjson_ai_posts: posts });
    return { success: true, entry };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getAIPosts() {
  try {
    const result = await chrome.storage.local.get(['reddjson_ai_posts']);
    return { success: true, posts: result.reddjson_ai_posts || [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function deleteAIPost(postId) {
  try {
    const result = await chrome.storage.local.get(['reddjson_ai_posts']);
    let posts = result.reddjson_ai_posts || [];
    posts = posts.filter(p => p.id !== postId);
    await chrome.storage.local.set({ reddjson_ai_posts: posts });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function clearAIPosts() {
  try {
    await chrome.storage.local.set({ reddjson_ai_posts: [] });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// STORAGE — SETTINGS
// ============================================================================

async function getSettings() {
  try {
    const result = await chrome.storage.local.get(['reddjson_settings']);
    const defaults = {
      providers: {},
      defaultProvider: '',
      defaultModel: '',
      systemPrompts: [
        { id: 'default', name: 'LinkedIn Viral Post', prompt: DEFAULT_SYSTEM_PROMPT, isDefault: true }
      ],
      activePromptId: 'default'
    };
    return { success: true, settings: { ...defaults, ...result.reddjson_settings } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ reddjson_settings: settings });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ReddJSON] Message:', message.action);

  (async () => {
    switch (message.action) {
      // ── Reddit JSON ──
      case 'fetchJSON':
        return await fetchRedditJSON(message.permalink);

      // ── History ──
      case 'addToHistory':
        return await addToHistory(message.entry);
      case 'getHistory':
        return await getHistory();
      case 'deleteHistoryEntry':
        return await deleteHistoryEntry(message.entryId);
      case 'clearHistory':
        return await clearHistory();
      case 'getHistoryEntry':
        return await getHistoryEntry(message.entryId);

      // ── AI Posts ──
      case 'getAIPosts':
        return await getAIPosts();
      case 'deleteAIPost':
        return await deleteAIPost(message.postId);
      case 'clearAIPosts':
        return await clearAIPosts();

      // ── AI Generation ──
      case 'generateLinkedInPost': {
        const settings = (await getSettings()).settings;
        const providerId = message.providerId || settings.defaultProvider;
        const modelId = message.modelId || settings.defaultModel;
        const promptId = message.promptId || settings.activePromptId || 'default';

        const providerConfig = settings.providers?.[providerId];
        if (!providerConfig?.apiKey) {
          return { success: false, error: 'No API key configured for ' + (PROVIDERS[providerId]?.name || providerId) };
        }

        const promptObj = settings.systemPrompts?.find(p => p.id === promptId);
        const systemPrompt = promptObj?.prompt || DEFAULT_SYSTEM_PROMPT;

        // Fetch Reddit JSON first
        const jsonResult = await fetchRedditJSON(message.permalink);
        if (!jsonResult.success) return jsonResult;

        // Extract media
        const media = extractMediaFromRedditJson(jsonResult.data);

        // Generate with AI
        const aiResult = await generateAIPost(
          providerId, providerConfig.apiKey, modelId, systemPrompt, jsonResult.data
        );
        if (!aiResult.success) return aiResult;

        // Save to AI posts history
        const saveResult = await addAIPost({
          permalink: message.permalink,
          redditTitle: message.title || 'Untitled',
          subreddit: message.subreddit || 'unknown',
          postId: message.postId || 'unknown',
          generatedText: aiResult.text,
          model: aiResult.model,
          provider: providerId,
          media,
          usage: aiResult.usage
        });

        return {
          success: true,
          text: aiResult.text,
          media,
          entry: saveResult.entry,
          usage: aiResult.usage,
          model: aiResult.model
        };
      }

      // ── Models ──
      case 'fetchModels':
        return await fetchModels(message.providerId, message.apiKey);

      // ── Settings ──
      case 'getSettings':
        return await getSettings();
      case 'saveSettings':
        return await saveSettings(message.settings);

      // ── Side panel ──
      case 'openSidePanel':
        try {
          // Open the side panel for the current tab
          if (sender.tab?.id) {
            await chrome.sidePanel.open({ tabId: sender.tab.id });
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }

      default:
        return { success: false, error: `Unknown action: ${message.action}` };
    }
  })().then(sendResponse).catch(err => {
    console.error('[ReddJSON] Handler error:', err);
    sendResponse({ success: false, error: err.message });
  });

  return true; // async response
});

// ============================================================================
// INSTALL / UPDATE
// ============================================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[ReddJSON] 🎉 Extension installed!');
    chrome.storage.local.set({
      reddjson_history: [],
      reddjson_ai_posts: [],
      reddjson_settings: {
        providers: {},
        defaultProvider: '',
        defaultModel: '',
        systemPrompts: [
          { id: 'default', name: 'LinkedIn Viral Post', prompt: DEFAULT_SYSTEM_PROMPT, isDefault: true }
        ],
        activePromptId: 'default'
      }
    });
  } else if (details.reason === 'update') {
    console.log('[ReddJSON] ⬆️ Updated to v' + chrome.runtime.getManifest().version);
  }
});

console.log('[ReddJSON] Background service worker v2.0 loaded ✓');
