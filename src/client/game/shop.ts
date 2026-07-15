import { apiClient } from "./api";
import { errorMessage, show, textIfPresent, toast } from "./dom";
import { syncPlayerState, updatePowerupHud } from "./hud";
import {
  BALL_SKINS,
  buyPowerup,
  buySkin,
  equipSkin,
  POWERUP_NAMES,
  POWERUP_ORDER,
  POWERUP_PRICES,
  type BallSkinId,
  type PowerupKind,
} from "./powerups";
import { ctx } from "./state";

/** Shop overlay: powerup purchases and ball skin buy/equip. */

export type ShopTab = "powerups" | "skins";
let activeShopTab: ShopTab = "powerups";

const POWERUP_DESCRIPTIONS: Record<PowerupKind, string> = {
  trajectory: "Aim preview for one shot.",
  sticky: "Place slime on a wall.",
  checkpoint: "Create one safe return flag.",
};

export function setShopTab(tab: ShopTab) {
  activeShopTab = tab;
  document
    .querySelectorAll<HTMLButtonElement>(".shop-tab")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.shopTab === tab);
    });
  document.querySelectorAll<HTMLElement>(".shop-section").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `shop-${tab}`);
  });
}

export function openShop(tab: ShopTab = activeShopTab) {
  setShopTab(tab);
  updateShop();
  show("shop-overlay");
}

export function updateShop() {
  textIfPresent("shop-wallet-coins", String(ctx.powerups.coins));
  textIfPresent("shop-coin-badge", String(ctx.powerups.coins));

  for (const kind of POWERUP_ORDER) {
    const price = POWERUP_PRICES[kind];
    const count = ctx.powerups.inventory[kind];
    const canBuy = ctx.powerups.coins >= price;
    const item = document.getElementById(`shop-powerup-${kind}`);
    const button = document.getElementById(
      `shop-buy-powerup-${kind}`,
    ) as HTMLButtonElement | null;
    const copy = item?.querySelector<HTMLParagraphElement>("p");
    textIfPresent(`shop-powerup-${kind}-owned`, `x${count} owned`);
    if (copy) copy.textContent = POWERUP_DESCRIPTIONS[kind];
    item?.classList.toggle("locked", !canBuy);
    if (button) {
      button.textContent = canBuy ? `BUY ${price}` : `NEED ${price}`;
      button.disabled = !canBuy;
      button.title = canBuy
        ? `Buy ${POWERUP_NAMES[kind]} for ${price} coins`
        : `Need ${price} coins for ${POWERUP_NAMES[kind]}`;
    }
  }

  for (const skin of BALL_SKINS) {
    const owned = ctx.powerups.skins.owned.includes(skin.id);
    const equipped = ctx.powerups.skins.equipped === skin.id;
    const canBuy = ctx.powerups.coins >= skin.price;
    const item = document.getElementById(`shop-skin-${skin.id}`);
    const button = document.getElementById(
      `shop-skin-${skin.id}-action`,
    ) as HTMLButtonElement | null;
    item?.classList.toggle("equipped", equipped);
    item?.classList.toggle("locked", !owned && !canBuy);
    textIfPresent(
      `shop-skin-${skin.id}-owned`,
      equipped ? "Equipped" : owned ? "Owned" : `${skin.price} coins`,
    );
    if (button) {
      button.textContent = equipped
        ? "EQUIPPED"
        : owned
          ? "EQUIP"
          : canBuy
            ? `BUY ${skin.price}`
            : `NEED ${skin.price}`;
      button.disabled = equipped || (!owned && !canBuy);
      button.classList.toggle("secondary", owned && !equipped);
      button.title = equipped
        ? `${skin.name} equipped`
        : owned
          ? `Equip ${skin.name}`
          : canBuy
            ? `Buy ${skin.name} for ${skin.price} coins`
            : `Need ${skin.price} coins for ${skin.name}`;
    }
  }
}

export async function buyPowerupFromShop(kind: PowerupKind) {
  if (ctx.economyRequestPending) return;
  if (ctx.powerups.coins < POWERUP_PRICES[kind]) {
    toast(`Need ${POWERUP_PRICES[kind]} coins`);
    return;
  }

  if (!ctx.accountBackedPlayer) {
    if (buyPowerup(ctx.powerups, kind)) {
      updatePowerupHud();
      toast(`${POWERUP_NAMES[kind]} bought`);
    }
    return;
  }

  ctx.economyRequestPending = true;
  try {
    const response = await apiClient.buyPowerup({ kind });
    syncPlayerState(response.player);
    toast(`${POWERUP_NAMES[kind]} bought`);
  } catch (error) {
    console.error("powerup purchase failed", error);
    toast(errorMessage(error, "Purchase failed. Try again."));
  } finally {
    ctx.economyRequestPending = false;
  }
}

export async function chooseSkin(skinId: BallSkinId) {
  const skin = BALL_SKINS.find((item) => item.id === skinId);
  if (!skin) return;
  const owned = ctx.powerups.skins.owned.includes(skinId);
  if (!owned && ctx.powerups.coins < skin.price) {
    toast(`Need ${skin.price} coins`);
    return;
  }

  if (ctx.economyRequestPending) return;
  if (ctx.accountBackedPlayer) {
    ctx.economyRequestPending = true;
    try {
      const response = await apiClient.chooseSkin({ skinId });
      syncPlayerState(response.player);
      toast(owned ? `${skin.name} equipped` : `${skin.name} bought`);
    } catch (error) {
      console.error("skin update failed", error);
      toast(errorMessage(error, "Skin update failed. Try again."));
      return;
    } finally {
      ctx.economyRequestPending = false;
    }
  } else if (owned) {
    if (!equipSkin(ctx.powerups, skinId)) return;
    toast(`${skin.name} equipped`);
  } else if (buySkin(ctx.powerups, skinId)) {
    toast(`${skin.name} bought`);
  }
  ctx.game?.events.emit("skin-changed", ctx.powerups.skins.equipped);
  updatePowerupHud();
}
