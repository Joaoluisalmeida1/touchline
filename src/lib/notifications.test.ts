import { describe, expect, it } from "vitest";
import { notificationText } from "./notifications";

describe("notificationText", () => {
  it("renders every known notification type in pt-PT", () => {
    expect(notificationText("member_joined", { display_name: "Ana" })).toBe("Ana entrou na liga.");
    expect(notificationText("member_joined", {})).toBe("Um manager entrou na liga.");
    expect(notificationText("game_started", { rounds: 34 })).toBe("A liga começou: 34 jornadas.");
    expect(notificationText("matchday_completed", { round: 3 })).toBe("Jornada 3 concluída.");
    expect(notificationText("season_completed", { season: 2 })).toBe("Época 2 terminada.");
    expect(notificationText("offer_rejected", {})).toBe("Uma proposta tua foi recusada.");
  });

  it("formats money from cents", () => {
    const text = notificationText("transfer_completed", { direction: "in", player: "Rui", amount_cents: 150_000_000 });
    expect(text).toMatch(/^Contrataste Rui por €1.500.000\.$/);
    expect(notificationText("offer_received", { buyer: "FC X", player: "Rui", amount_cents: 10_000_000 })).toMatch(/^Proposta de FC X por Rui: €100.000\.$/);
  });

  it("falls back to the raw type for unknown notifications", () => {
    expect(notificationText("something_new", {})).toBe("something_new");
  });
});
