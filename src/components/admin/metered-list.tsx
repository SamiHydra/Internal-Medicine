/**
 * Shared row shell for the academic card lists (leaderboard, attendance,
 * student progress): a bordered card with a calm, colour-only hover. Gap is set
 * per caller (append `gap-4` / `gap-5`) so no two utilities collide.
 */
export const cardRowClass =
  'group relative grid items-center rounded-[0.7rem] border border-[#e9eef4] bg-white px-3 py-3 transition-colors duration-150 ease-out hover:border-[#cfe0f4] hover:bg-[#f8fafc] sm:px-4'
