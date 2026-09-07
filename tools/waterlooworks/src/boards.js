const { z } = require("zod");
const BOARDS = ["Co-op", "Employer-Student Direct", "Graduating and Full-Time"];
const aliases = { coop: BOARDS[0], "co-op": BOARDS[0], direct: BOARDS[1], "employer-student direct": BOARDS[1], graduate: BOARDS[2], "full-time": BOARDS[2], "graduating and full-time": BOARDS[2], both: "both", all: "all" };
const boardSchema = z.string().transform((value, ctx) => {
  const board = aliases[value.toLowerCase()];
  if (!board) { ctx.addIssue({ code: "custom", message: "Invalid board selector" }); return z.NEVER; }
  return board;
});
function selectBoards(selector = "Co-op") {
  const board = boardSchema.parse(selector);
  return board === "all" ? BOARDS : board === "both" ? BOARDS.slice(0, 2) : [board];
}
module.exports = { BOARDS, boardSchema, selectBoards };
