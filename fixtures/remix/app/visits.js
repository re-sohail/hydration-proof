// Module-level state: `/` sets `from` in an effect, so `/nav-target` renders
// different content after a client-side navigation than on a direct load.
export const visits = { from: undefined };
