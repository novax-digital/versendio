import { describe, expect, it } from "vitest";
import { groupActiveFlowsByList, type ActiveFlowOption } from "@/lib/shared/flows";

const flow = (id: string, name: string, listId: string): ActiveFlowOption => ({ id, name, listId });

describe("groupActiveFlowsByList", () => {
  it("returns one group per list for the common 1:1 case", () => {
    const groups = groupActiveFlowsByList([
      flow("f1", "Willkommen", "l1"),
      flow("f2", "Angebot", "l2"),
    ]);
    expect(groups).toEqual([
      { listId: "l1", flows: [flow("f1", "Willkommen", "l1")] },
      { listId: "l2", flows: [flow("f2", "Angebot", "l2")] },
    ]);
  });

  it("collapses flows that share a list into a single group", () => {
    // Enrollment is list-based: both flows on l1 fire together, so they must be
    // one selectable entry — the reason the picker groups instead of listing
    // per flow.
    const groups = groupActiveFlowsByList([
      flow("f1", "Tag 0", "l1"),
      flow("f2", "Tag 7", "l1"),
      flow("f3", "Solo", "l2"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      listId: "l1",
      flows: [flow("f1", "Tag 0", "l1"), flow("f2", "Tag 7", "l1")],
    });
    expect(groups[1]).toEqual({ listId: "l2", flows: [flow("f3", "Solo", "l2")] });
  });

  it("preserves first-occurrence (newest-first) order and handles empty input", () => {
    expect(groupActiveFlowsByList([])).toEqual([]);
    const groups = groupActiveFlowsByList([
      flow("f1", "B", "l2"),
      flow("f2", "A", "l1"),
      flow("f3", "C", "l2"),
    ]);
    expect(groups.map((g) => g.listId)).toEqual(["l2", "l1"]);
    expect(groups[0].flows.map((f) => f.id)).toEqual(["f1", "f3"]);
  });
});
