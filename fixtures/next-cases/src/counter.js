// Shared counter behind /api/counter. Each read increments it, so a server
// render and a later browser fetch always disagree.
let visits = 0;

export function nextVisit() {
  visits += 1;
  return visits;
}
