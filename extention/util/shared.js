(function(){
  'use strict';
  // Shared utilities used by both optimizer.js and stream-hooks.js
  
  // URL and conversation ID helpers
  const URL_RX = /\/backend-api\/conversation\/([0-9a-f-]{36})(?:\?.*)?$/i;
  
  const convIdFromUrl = u => (String(u||'').match(URL_RX)||[])[1]||null;
  
  const convIdFromLocation = () => {
    const href = location.href;
    // Try /c/ or /share/ first (more specific)
    const m = href.match(/\/(?:c|share)\/([0-9a-f-]{36})/i);
    if (m) return m[1];
    // Fallback to any UUID
    return (href.match(/[0-9a-f-]{36}/i) || [])[0] || null;
  };

  // Tool noise detection
  const TOOL_TYPES = new Set([
    'tool','tools','function_call','function_output','system','thought','reasoning',
    'search_query','image_query','product_query','open','click','find','screenshot',
    'finance','weather','sports','calculator','time','response_length','web.run'
  ]);

  const TOOL_NOISE_RX = /"(search_query|image_query|product_query|open|click|find|screenshot|finance|weather|sports|calculator|time|response_length)"\s*:/;
  const TOOL_NOISE_KEYS = new Set(['search_query','image_query','product_query','open','click','find','screenshot','finance','weather','sports','calculator','time','response_length','domains','recency']);

  const isToolNoiseText = (raw) => { 
    if(!raw) return false; 
    let s = String(raw).trim(); 
    if(s.startsWith('```')) s = s.replace(/^```[a-zA-Z0-9_-]*\n?/,'').replace(/```$/,'').trim(); 
    if(!s.startsWith('{')||!s.endsWith('}')) return false;
    if(TOOL_NOISE_RX.test(s)) return true;
    try{ 
      const obj = JSON.parse(s); 
      return Object.keys(obj||{}).some(k=>TOOL_NOISE_KEYS.has(k)); 
    } catch{}
    return false;
  };

  const isReasoningType = t => { 
    const s = String(t||'').toLowerCase(); 
    return s.includes('thought')||s.includes('reasoning')||s.includes('model_editable_context'); 
  };

  // Extract conversation ID from various sources
  const extractConvId = (source) => {
    if (typeof source === 'string') return convIdFromUrl(source) || null;
    if (source && typeof source === 'object') {
      return source.conversation_id || source.id || null;
    }
    return convIdFromLocation() || null;
  };

  // Conversation graph traversal utilities
  const findLeafNode = (mapping) => {
    let leafId = null, latestTime = -Infinity;
    for (const id in mapping) {
      const node = mapping[id];
      const hasChildren = Array.isArray(node?.children) && node.children.length > 0;
      if (!hasChildren) {
        // Support both node.update_time and node.message.update_time
        const t = node?.update_time || node?.create_time || 
                  node?.message?.update_time || node?.message?.create_time || -Infinity;
        if (t > latestTime) { latestTime = t; leafId = id; }
      }
    }
    return leafId || Object.keys(mapping)[Object.keys(mapping).length - 1] || null;
  };

  const buildNodeChain = (mapping, leafId) => {
    const chain = [];
    let id = leafId;
    const seen = new Set(); // Prevent infinite loops
    while (id && !seen.has(id)) {
      const node = mapping[id];
      if (!node) break;
      chain.push(id);
      seen.add(id);
      id = node.parent || null;
    }
    chain.reverse();
    return chain;
  };

  // Export shared utilities
  window.TailShared = {
    URL_RX,
    TOOL_TYPES,
    TOOL_NOISE_RX,
    TOOL_NOISE_KEYS,
    convIdFromUrl,
    convIdFromLocation,
    isToolNoiseText,
    isReasoningType,
    extractConvId,
    findLeafNode,
    buildNodeChain
  };
})();
