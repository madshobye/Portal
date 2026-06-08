export function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
