import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketStore } from '../stores/websocket.store';
import { monitoringKeys } from './useMonitoring';

const SESSION_EVENTS = new Set([
  'session:updated',
  'session:message',
  'session:state',
  'presence',
  'health',
]);

const LOG_EVENTS = new Set([
  'log:entry',
]);

const DIAGNOSTIC_EVENTS = new Set([
  'diagnostic:event',
]);

const MACHINE_EVENTS = new Set([
  'machine:status',
  'job:health-check',
]);

/**
 * Bridges WebSocket events to React Query cache invalidation so
 * monitoring data refreshes immediately when new data arrives,
 * rather than waiting for the next polling interval.
 */
export function useWebSocketQuerySync(): void {
  const queryClient = useQueryClient();
  const events = useWebSocketStore((s) => s.events);
  const lastSeenTimestampRef = useRef<string | null>(null);

  useEffect(() => {
    if (events.length === 0) return;

    const newestTimestamp = events[0].timestamp;
    if (newestTimestamp === lastSeenTimestampRef.current) return;

    // Find new events since last seen (events are newest-first)
    const newEvents = [];
    for (const event of events) {
      if (event.timestamp === lastSeenTimestampRef.current) break;
      newEvents.push(event);
    }
    lastSeenTimestampRef.current = newestTimestamp;

    if (newEvents.length === 0) return;

    let invalidateSessions = false;
    let invalidateLogs = false;
    let invalidateEvents = false;
    let invalidateDashboard = false;

    for (const event of newEvents) {
      if (SESSION_EVENTS.has(event.type)) {
        invalidateSessions = true;
        invalidateDashboard = true;
      }
      if (LOG_EVENTS.has(event.type)) {
        invalidateLogs = true;
      }
      if (DIAGNOSTIC_EVENTS.has(event.type)) {
        invalidateEvents = true;
        invalidateDashboard = true;
      }
      if (MACHINE_EVENTS.has(event.type)) {
        invalidateDashboard = true;
      }
    }

    if (invalidateSessions) {
      queryClient.invalidateQueries({ queryKey: monitoringKeys.sessions() });
    }
    if (invalidateLogs) {
      queryClient.invalidateQueries({ queryKey: monitoringKeys.logs() });
    }
    if (invalidateEvents) {
      queryClient.invalidateQueries({ queryKey: monitoringKeys.events() });
    }
    if (invalidateDashboard) {
      queryClient.invalidateQueries({ queryKey: monitoringKeys.dashboard() });
    }
  }, [events, queryClient]);
}
