/**
 * LocalStorage Scan History Manager
 */

const STORAGE_KEY = 'scanverse_history_v1';

export function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load scan history:', e);
    return [];
  }
}

export function saveScanToHistory(parsedItem) {
  const history = getHistory();
  
  // Deduplicate exact same raw content if scanned within 5 seconds
  if (history.length > 0) {
    const lastItem = history[0];
    if (lastItem.raw === parsedItem.raw && (Date.now() - lastItem.id) < 5000) {
      return history;
    }
  }

  const newItem = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: parsedItem.type,
    typeName: parsedItem.typeName,
    title: parsedItem.title,
    raw: parsedItem.raw
  };

  const updated = [newItem, ...history];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated.slice(0, 100))); // limit to 100 items
  } catch (e) {
    console.error('Failed to save scan to history:', e);
  }
  return updated;
}

export function deleteHistoryItem(id) {
  const history = getHistory();
  const updated = history.filter(item => item.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to update history:', e);
  }
  return updated;
}

export function clearAllHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear history:', e);
  }
  return [];
}

export function exportHistoryAsCSV() {
  const history = getHistory();
  if (history.length === 0) return null;

  const headers = ['Timestamp', 'Type', 'Title', 'Content'];
  const rows = history.map(item => [
    `"${item.timestamp}"`,
    `"${item.typeName}"`,
    `"${(item.title || '').replace(/"/g, '""')}"`,
    `"${(item.raw || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  return csvContent;
}
