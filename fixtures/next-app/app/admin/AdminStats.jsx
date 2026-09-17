'use client';

// Deliberately broken: only an authenticated admin run can reach it.
export function AdminStats() {
  return <p id="admin-stats">Active sessions: {Math.floor(Math.random() * 1000)}</p>;
}
