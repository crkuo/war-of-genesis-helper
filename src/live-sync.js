// LiveSync: WebSocket/CDP bridge to the game's Puerts V8 inspector (ws://127.0.0.1:10998).
//
// Boundary: this module owns the transport (connect/reconnect/poll loop), the CDP
// message framing (Runtime.evaluate), and the injected game-side query script that
// reads/mutates `nn.*` internals inside the game's JS runtime. It knows nothing about
// the app's DOM, rendering, or settings state — those cross the boundary only through
// the callbacks registered below (onData/onStatus/onConnect/onDisconnect) and the
// config provider (setPollConfigProvider).
window.LiveSync = (function () {
  'use strict';

  const WS_URL = 'ws://127.0.0.1:10998';
  const STEAM_APP_PROTOCOL = 'steam://run/4891320';

  let liveWs = null;
  let liveSyncTimer = null;
  let pollMsgSeq = 1;
  let isActive = true;

  let consecutiveDisconnects = 0;
  let lastRelaunchTime = 0;
  let isAutoRelaunchActive = localStorage.getItem('genesis_auto_relaunch_steam') !== 'false'; // Default TRUE

  // App registers this to supply feature-flag/config values needed by the in-game
  // query script (auto-equip toggles, warehouse tab overrides, etc).
  let getPollConfig = function () {
    return {
      autoEquipWeapon: false,
      autoEquipSkill: false,
      autoReconnectConfirm: false,
      sameLevelOnly: false,
      manualWarehouseTabs: localStorage.getItem('genesis_warehouse_tabs_mode') || 'auto',
      savedWarehouseTabs: parseInt(localStorage.getItem('genesis_detected_warehouse_tabs') || '1', 10)
    };
  };

  let dataHandler = function () {};
  let statusHandler = function () {};
  let connectHandler = function () {};
  let disconnectHandler = function () {};

  function scheduleNextPoll(delayMs) {
    if (liveSyncTimer) clearTimeout(liveSyncTimer);
    if (!isActive) return;
    liveSyncTimer = setTimeout(pollLiveGame, delayMs !== undefined ? delayMs : 2000);
  }

  function start() {
    isActive = true;
    statusHandler('connecting');
    scheduleNextPoll(50);
  }

  function stop() {
    isActive = false;
    if (liveSyncTimer) {
      clearTimeout(liveSyncTimer);
      liveSyncTimer = null;
    }
    if (liveWs) {
      try { liveWs.close(); } catch(e){}
      liveWs = null;
    }
    statusHandler('paused');
  }

  function toggle() {
    if (isActive) {
      stop();
    } else {
      start();
    }
  }

  // Used by the app's one-time bootstrap, which already knows isActive defaulted to
  // true and just needs the first poll scheduled without re-announcing 'connecting'.
  function kickoff(delayMs) {
    scheduleNextPoll(delayMs);
  }

  function pollNow() {
    pollLiveGame();
  }

  function triggerSteamRelaunch(silent) {
    console.log('Triggering Steam Relaunch: ' + STEAM_APP_PROTOCOL);
    lastRelaunchTime = Date.now();

    // Method 1: Invisible iframe for seamless background protocol invocation without disrupting UI
    let iframe = document.getElementById('steam_protocol_iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'steam_protocol_iframe';
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
    }
    iframe.src = STEAM_APP_PROTOCOL;

    // Method 2: Direct location fallback
    setTimeout(() => {
      try {
        window.location.href = STEAM_APP_PROTOCOL;
      } catch(e) {
        console.warn('Cannot open steam protocol directly:', e);
      }
    }, 400);
  }

  function noteDisconnected() {
    consecutiveDisconnects++;
    disconnectHandler(consecutiveDisconnects);

    // Hands-free auto-relaunch: Triggers immediately after 2 failed attempts (~6s)
    if (isAutoRelaunchActive && consecutiveDisconnects >= 2) {
      const now = Date.now();
      // Cooldown 45s between relaunch calls
      if (now - lastRelaunchTime > 45000) {
        console.log('Mất kết nối vượt ngưỡng (' + consecutiveDisconnects + '). Đang TỰ ĐỘNG mở lại game qua Steam protocol...');
        triggerSteamRelaunch(true);
      }
    }
  }

  function noteConnected() {
    consecutiveDisconnects = 0;
    connectHandler();
  }

  // 32-bit integer message id required by Puerts Inspector C++ parser
  function nextMsgId() {
    return (pollMsgSeq++ % 100000) + 1;
  }

  // Generic escape hatch for one-off Runtime.evaluate calls (used by app code that
  // needs to poke game state outside the regular poll cycle, e.g. queueing a jewel
  // command or resetting the stage tracker).
  function evaluate(expression, opts) {
    if (!liveWs || liveWs.readyState !== WebSocket.OPEN) return false;
    opts = opts || {};
    liveWs.send(JSON.stringify({
      id: opts.id !== undefined ? opts.id : nextMsgId(),
      method: 'Runtime.evaluate',
      params: {
        expression: expression,
        awaitPromise: opts.awaitPromise !== undefined ? opts.awaitPromise : false,
        returnByValue: opts.returnByValue !== undefined ? opts.returnByValue : true
      }
    }));
    return true;
  }

  function pollLiveGame() {
    if (!isActive) return;

    if (!liveWs || liveWs.readyState !== WebSocket.OPEN) {
      if (liveWs && liveWs.readyState === WebSocket.CONNECTING) {
        scheduleNextPoll(2000);
        return;
      }
      try {
        liveWs = new WebSocket(WS_URL);
      } catch(err) {
        statusHandler('offline');
        scheduleNextPoll(2500);
        return;
      }

      liveWs.onopen = function() {
        sendEvaluatePoll();
      };

      liveWs.onmessage = function(msg) {
        try {
          const res = JSON.parse(msg.data);
          if (res.result && res.result.result && res.result.result.value) {
            const data = JSON.parse(res.result.result.value);
            if (data && data.nickname) {
              dataHandler(data);
              statusHandler('online');
              noteConnected();
            }
          }
        } catch(e){}
        scheduleNextPoll(2000);
      };

      liveWs.onerror = function() {
        statusHandler('offline');
        noteDisconnected();
        try { liveWs.close(); } catch(e){}
        liveWs = null;
        scheduleNextPoll(3000);
      };

      liveWs.onclose = function() {
        statusHandler('offline');
        liveWs = null;
        scheduleNextPoll(3000);
      };

      setTimeout(function() {
        if (liveWs && liveWs.readyState !== WebSocket.OPEN) {
          statusHandler('offline');
          try { liveWs.close(); } catch(e){}
          liveWs = null;
        }
      }, 2000);

    } else {
      sendEvaluatePoll();
    }
  }

  // Builds the script injected into the game's V8 context (via CDP Runtime.evaluate)
  // that reads live character/inventory/stage state out of the game's internal `nn`
  // namespace, and returns it JSON-serialized. This is reverse-engineered against the
  // game's internal object graph, not app code — relocated verbatim from the previous
  // inline implementation, only the trailing cfg injection now goes through
  // getPollConfig() instead of reaching into app globals directly.
  function sendEvaluatePoll() {
    if (!liveWs || liveWs.readyState !== WebSocket.OPEN) return;

    const code = '(' + (async function(cfg) {
    try {
      let userC, stageC, treeC, itemC, sUser, sCombat, sContent, sTree;
      for (let [k, v] of nn.netData._mapContainer.entries()) {
        const name = k.name || k.toString();
        if (name === 'NetContainerUser') userC = v;
        if (name === 'NetContainerStage') stageC = v;
        if (name === 'NetContainerTree') treeC = v;
        if (name === 'NetContainerItem') itemC = v;
      }
      for (let [k, v] of nn.services._mapService.entries()) {
        const name = k.name || k.toString();
        if (name === 'ServiceUser') sUser = v;
        if (name === 'ServiceCombat') sCombat = v;
        if (name === 'ServiceContentState') sContent = v;
        if (name === 'ServiceTree') sTree = v;
      }

      const currencies = {};
      if (itemC && itemC._mapItemStack) {
        for (let k of itemC._mapItemStack.keys()) {
          const it = itemC._mapItemStack.getValue(k);
          if (it) currencies[k] = { tid: it._itemTid, count: it._cnt ? it._cnt.toString() : '0' };
        }
      }

      let expInfo = null;
      try {
        if (sUser && sUser.getCurrentExpInfo) {
          const rawExp = sUser.getCurrentExpInfo();
          if (rawExp) {
            const curExp = Number(rawExp.curExp || 0);
            const maxExp = Number(rawExp.maxExp || 1);
            expInfo = {
              level: rawExp.level || (userC && userC._user ? userC._user._lv : 32),
              curExp: curExp,
              maxExp: maxExp,
              expRemaining: Math.max(0, maxExp - curExp),
              expRate: rawExp.expRate !== undefined ? rawExp.expRate : (curExp / maxExp),
              isMaxLevel: !!rawExp.isMaxLevel
            };
          }
        }
      } catch(e){}

      let stageTid = 13208;
      let clearStageTid = 13209;
      let maxUnlockedStageTid = 13210;
      try {
        if (stageC && stageC._stageInfo) {
          stageTid = stageC._stageInfo._stageTid || 13208;
          clearStageTid = stageC._stageInfo._clearStageTid || stageTid;
          maxUnlockedStageTid = Math.max(stageTid, clearStageTid + 1);
        }
      } catch(e){}
      let mySkills = [];
      try {
        if (sCombat && sCombat.createMySkillTids) {
          mySkills = sCombat.createMySkillTids() || [];
        }
      } catch(e){}

      const stats = {};
      try {
        if (!sContent && nn.services && nn.services.contentState) sContent = nn.services.contentState;
        if (sContent && sContent.getValue) {
          // Exact character combat abilities from ServiceContentState
          stats.finalAttack = sContent.getValue(101) || 1337.6;
          stats.finalDefense = sContent.getValue(102) || 2219.9;
          stats.finalHp = sContent.getValue(103) || 9671.5;
          stats.finalAttackSpeed = sContent.getValue(104) || 115.95;
          stats.finalCriticalRate = sContent.getValue(106) || 23.6;
          stats.finalCriticalDamage = sContent.getValue(107) || 192.7;
          stats.damageBonus = sContent.getValue(1058) || 0; // Sát thương + (General Damage Amp %)
          stats.pveBonus = sContent.getValue(1054) || 0;    // Sức tấn công PvE + (%)
          stats.bossBonus = sContent.getValue(1057) || 0;   // Sát thương Boss + (%)
          stats.pvpBonus = sContent.getValue(1065) || 0;    // Sức tấn công PvP + (%)
        }
      } catch(e){}

      // === LIVE SKILL TREE & TRAINING SKILLS: read actual levels from NetContainerTree & ServiceTree ===
      const liveSkillLevels = {};
      const trainingSkills = {};
      try {
        let treeType1 = null;
        let treeType4 = null;
        for (let [k, v] of treeC._mapTreeInfo.entries()) {
          if (k === 1) treeType1 = v;
          if (k === 4) treeType4 = v;
        }
        // Training skills (Category 1) - directly query true reached level from ServiceTree
        if (treeType1 && treeType1._dicValue) {
          for (let [groupTid, treeInfo] of treeType1._dicValue.entries()) {
            const treeTid = treeInfo._treeTid;
            const reachedLv = sTree ? sTree.getReachedLevel(1, groupTid) : 0;
            const level = reachedLv > 0 ? reachedLv : (treeTid > groupTid ? (treeTid - groupTid) : (treeTid % 100));
            trainingSkills[groupTid] = { tid: treeTid, level: level };
          }
        } else if (treeType1 && treeType1.keys) {
          for (let sk of treeType1.keys()) {
            const node = treeType1.getValue(sk);
            if (node) {
              const reachedLv = sTree ? sTree.getReachedLevel(1, sk) : 0;
              const level = reachedLv > 0 ? reachedLv : (node._treeTid > sk ? (node._treeTid - sk) : (node._treeTid % 100));
              trainingSkills[sk] = { tid: node._treeTid, level: level };
            }
          }
        }
        // Active skill tree (Category 4)
        if (treeType4 && treeType4._dicValue) {
          for (let [groupTid, treeInfo] of treeType4._dicValue.entries()) {
            const treeTid = treeInfo._treeTid;
            const reachedLv = sTree ? sTree.getReachedLevel(4, groupTid) : 0;
            const level = reachedLv > 0 ? reachedLv : (treeTid > groupTid ? (Math.floor((treeTid - groupTid) / 10) + 1) : 1);
            liveSkillLevels[groupTid] = { treeTid: treeTid, level: level };
          }
        }
      } catch(e) {}

      // === AUTO CLASS DETECTION & AUTO EQUIP WEAPONS + SKILLS ===
      let heroClassType = 2; // 1: Melee, 2: Ranged, 3: Mage
      try {
        if (nn.services.hero && nn.services.hero.getCurrentHeroClassType) {
          heroClassType = nn.services.hero.getCurrentHeroClassType();
        }
      } catch(e) {}

      let heroClass = heroClassType === 1 ? 'Melee' : (heroClassType === 3 ? 'Mage' : 'Ranged');
      if (!heroClassType && mySkills && mySkills.length > 0) {
        const firstTid = String(mySkills[0]);
        if (firstTid.startsWith('81')) heroClass = 'Melee';
        else if (firstTid.startsWith('83')) heroClass = 'Mage';
        else heroClass = 'Ranged';
      }

      let classSwitched = false;
      let prevClassType = globalThis.__lastActiveHeroClassType;
      if (globalThis.__lastActiveHeroClassType === undefined) {
        globalThis.__lastActiveHeroClassType = heroClassType;
      } else if (globalThis.__lastActiveHeroClassType !== heroClassType) {
        classSwitched = true;
        globalThis.__lastActiveHeroClassType = heroClassType;
      }

      let autoEquipWeaponRes = null;
      let autoEquipSkillRes = null;
      let manualEquipWeapons = false;
      let manualEquipSkills = false;

      // Helper to auto equip best weapons for hero class (PartsType 1 = Main, PartsType 2 = Sub)
      async function autoEquipBestWeaponsForClass(targetClassType) {
        try {
          const sHero = nn.services.hero;
          const sEquip = nn.services.equipment;
          const sPreset = nn.services.preset;
          const pGear = sPreset ? sPreset.gear : null;
          const gameSession = nn.net.manager.gameSession;
          if (!pGear || !gameSession) return { error: 'No gear preset or game session' };

          const userLv = nn.net.data.user ? nn.net.data.user.lv : 33;
          const allItems = nn.net.data.item.getAllItemNotStack();

          const getItemScore = (it, dbEq) => {
            const rating = dbEq.RatingType || 1;
            const attack = dbEq.BaseAttack || (dbEq.EquipAbilityDetail && dbEq.EquipAbilityDetail[0]) || 0;
            return (rating * 1000000) + attack;
          };

          let candidatesMain = [];
          let candidatesSub = [];

          for (let it of allItems) {
            if (it.location !== 1 && it.location !== 2 && it.location !== 3) continue;
            const dbEq = nn.db.equip.get(it.itemTid);
            if (!dbEq) continue;

            // Must be compatible with class
            if (!nn.db.equip.canEquipByHeroClass(it.itemTid, targetClassType)) continue;

            const limitLv = (sEquip && sEquip.getEquipLimitLevel) ? sEquip.getEquipLimitLevel(it.itemTid, it.itemId) : (dbEq.BaseLimitLevel || 1);
            if (userLv < limitLv) continue;

            if (dbEq.PartsType === 1) {
              candidatesMain.push({ it, dbEq, score: getItemScore(it, dbEq) });
            } else if (dbEq.PartsType === 2) {
              candidatesSub.push({ it, dbEq, score: getItemScore(it, dbEq) });
            }
          }

          candidatesMain.sort((a, b) => b.score - a.score);
          candidatesSub.sort((a, b) => b.score - a.score);

          const bestMain = candidatesMain.length > 0 ? candidatesMain[0] : null;
          const bestSub = candidatesSub.length > 0 ? candidatesSub[0] : null;
          const result = { main: null, sub: null };

          if (bestMain) {
            const mItem = bestMain.it;
            const mDb = bestMain.dbEq;
            const mLoc = nn.db.locale.get(mDb.ItemName);
            const mName = mLoc?.VI || mLoc?.EN || mDb.ItemName;
            if (mItem.location !== 3) {
              if (mItem.location === 2) {
                let sim = null;
                for (let [k, v] of nn.services._mapService.entries()) {
                  if (k.name === 'ServiceItemMove' || k.toString() === 'ServiceItemMove') sim = v;
                }
                let transitIdx = sim ? sim.findInventoryEmptyTargetIdx() : -1;
                if (transitIdx < 0) {
                  const usedSlots = new Set(allItems.filter(i => i.location === 1).map(i => i.slotIdx));
                  transitIdx = 0;
                  while (usedSlots.has(transitIdx) && transitIdx < 100) transitIdx++;
                }
                const moveOutRes = await gameSession.reqStorageMoveOut(mItem.itemId, transitIdx);
                if (moveOutRes && moveOutRes.hasError && moveOutRes.hasError()) {
                  result.main = { tid: mItem.itemTid, name: mName, tier: mDb.RatingType, error: 'Storage move out failed' };
                } else {
                  await pGear.reqEquipCurrentPreset(1, mItem.itemTid, mItem.itemId);
                  result.main = { tid: mItem.itemTid, name: mName, tier: mDb.RatingType, from: 'Kho' };
                }
              } else {
                await pGear.reqEquipCurrentPreset(1, mItem.itemTid, mItem.itemId);
                result.main = { tid: mItem.itemTid, name: mName, tier: mDb.RatingType, from: 'Balo' };
              }
            } else {
              result.main = { tid: mItem.itemTid, name: mName, tier: mDb.RatingType, status: 'already_equipped' };
            }
          }

          if (bestSub) {
            const sItem = bestSub.it;
            const sDb = bestSub.dbEq;
            const sLoc = nn.db.locale.get(sDb.ItemName);
            const sName = sLoc?.VI || sLoc?.EN || sDb.ItemName;
            if (sItem.location !== 3) {
              if (sItem.location === 2) {
                let sim = null;
                for (let [k, v] of nn.services._mapService.entries()) {
                  if (k.name === 'ServiceItemMove' || k.toString() === 'ServiceItemMove') sim = v;
                }
                let transitIdx = sim ? sim.findInventoryEmptyTargetIdx() : -1;
                if (transitIdx < 0) {
                  const freshAllItems = nn.net.data.item.getAllItemNotStack();
                  const usedSlots = new Set(freshAllItems.filter(i => i.location === 1).map(i => i.slotIdx));
                  transitIdx = 0;
                  while (usedSlots.has(transitIdx) && transitIdx < 100) transitIdx++;
                }
                const moveOutRes = await gameSession.reqStorageMoveOut(sItem.itemId, transitIdx);
                if (moveOutRes && moveOutRes.hasError && moveOutRes.hasError()) {
                  result.sub = { tid: sItem.itemTid, name: sName, tier: sDb.RatingType, error: 'Storage move out failed' };
                } else {
                  await pGear.reqEquipCurrentPreset(2, sItem.itemTid, sItem.itemId);
                  result.sub = { tid: sItem.itemTid, name: sName, tier: sDb.RatingType, from: 'Kho' };
                }
              } else {
                await pGear.reqEquipCurrentPreset(2, sItem.itemTid, sItem.itemId);
                result.sub = { tid: sItem.itemTid, name: sName, tier: sDb.RatingType, from: 'Balo' };
              }
            } else {
              result.sub = { tid: sItem.itemTid, name: sName, tier: sDb.RatingType, status: 'already_equipped' };
            }
          }

          return result;
        } catch(err) {
          return { error: err.toString() };
        }
      }

      // Helper to auto equip matching skills for hero class dynamically from Skill Tree up to 6 skills
      // Helper to auto equip matching skills for hero class dynamically from Skill Tree up to 6 skills
      async function autoEquipSkillsForClass(targetClassType) {
        try {
          const pSkill = nn.services.preset.skill;
          const sHero = nn.services.hero;
          if (!pSkill) return { error: 'No skill preset' };

          const userLv = nn.net.data.user ? nn.net.data.user.lv : 35;

          // 1. Retrieve skills actually learned on Skill Tree (TreeType 4 = SkillTree)
          let learnedTids = [];
          try {
            if (nn.services.tree && nn.services.tree.getAllTreeTid) {
              learnedTids = nn.services.tree.getAllTreeTid(4) || [];
            }
          } catch (e) {}

          if (learnedTids.length === 0) {
            try {
              for (let [k, v] of nn.services._mapService.entries()) {
                const name = k.name || k.toString();
                if (name === 'ServiceTree' && v.getAllTreeTid) {
                  learnedTids = v.getAllTreeTid(4) || [];
                }
              }
            } catch (e) {}
          }

          if (learnedTids.length === 0 && nn.net.data.tree && nn.net.data.tree._mapTreeInfo) {
            try {
              const sub = nn.net.data.tree._mapTreeInfo.get(4);
              if (sub && sub.getValuesArray) {
                learnedTids = sub.getValuesArray().map(v => v.treeTid);
              }
            } catch(e) {}
          }

          let targetSkills = [];

          if (learnedTids.length > 0) {
            const candidates = [];
            const seenGroups = new Set();

            for (let tid of learnedTids) {
              const sk = nn.db.skill && nn.db.skill.get ? nn.db.skill.get(tid) : null;
              if (!sk) continue;
              // Must be an Active skill (SkillClassType === 2). Passives (3) cannot be equipped in preset slots
              if (sk.SkillClassType !== 2) continue;
              // Must match target hero class
              if (sk.HeroClassType !== targetClassType) continue;

              // Server preset table requires base GroupID (Level 1 tid), e.g. 8301010 instead of 8301030
              const baseTid = sk.GroupID || sk.SkillID;
              if (seenGroups.has(baseTid)) continue;
              seenGroups.add(baseTid);

              const baseDb = (nn.db.skill && nn.db.skill.get ? nn.db.skill.get(baseTid) : null) || sk;
              const locKey = baseDb.SkilName || baseDb.SkillName;
              const loc = locKey ? nn.db.locale.get(locKey) : null;
              candidates.push({
                skillId: baseTid,
                order: baseDb.Order || 1,
                openLv: baseDb.OpenLevel || 1,
                name: loc?.VI || loc?.EN || locKey || ('Skill ' + baseTid)
              });
            }

            // Sort: Order 1 (primary attack) first, then Order 2, 3, etc.
            // Within same order, higher OpenLevel = higher tier skill
            candidates.sort((a, b) => {
              if (a.order !== b.order) return a.order - b.order;
              return b.openLv - a.openLv;
            });

            targetSkills = candidates.slice(0, 6);
          }

          // Safe fallback with verified learned active skills if tree sync is pending
          if (targetSkills.length === 0) {
            const fallbackMap = {
              1: [8101010, 8108010, 8102010, 8109010, 8103010, 8104010],
              2: [8201010, 8208010, 8202010, 8209010, 8203010, 8210010],
              3: [8301010, 8308010, 8302010, 8309010, 8303010, 8310010]
            };
            const list = fallbackMap[targetClassType] || fallbackMap[2];
            targetSkills = list.map(tid => {
              const skDb = nn.db.skill && nn.db.skill.get ? nn.db.skill.get(tid) : null;
              const locKey = skDb?.SkilName || skDb?.SkillName;
              const loc = locKey ? nn.db.locale.get(locKey) : null;
              return {
                skillId: tid,
                name: loc?.VI || loc?.EN || locKey || ('Skill ' + tid)
              };
            });
          }

          const curPresetNo = pSkill.getCurrentPresetNumber();
          const openSlotCount = sHero && sHero.getOpenSkillSlotCount ? sHero.getOpenSkillSlotCount() : 6;
          const slotsToEquip = Math.min(openSlotCount, targetSkills.length);
          const equippedSkills = [];

          // 1. Unequip all existing slots cleanly 1..6 first to eliminate duplicate skill collision or remaining skills from previous class
          for (let slotIdx = 1; slotIdx <= 6; slotIdx++) {
            const s = pSkill.getPresetItemSlot(curPresetNo, slotIdx);
            if (s && s.itemTid > 0) {
              await pSkill.reqUnEquipCurrentPreset(slotIdx);
            }
          }

          // 2. Equip target skills into slots
          for (let slotIdx = 1; slotIdx <= slotsToEquip; slotIdx++) {
            const skillObj = targetSkills[slotIdx - 1];
            const skillTid = skillObj.skillId;
            const res = await pSkill.reqEquipCurrentPreset(slotIdx, skillTid, 0n);
            if (!res || !res.hasError || !res.hasError()) {
              equippedSkills.push({ slot: slotIdx, tid: skillTid, name: skillObj.name });
            }
          }

          // 3. Force UI refresh on open PanelCharacterSetting and PanelCharacter so UI checkmarks and slots update immediately
          try {
            const pSetting = nn.ui.manager.getPanel("PanelCharacterSetting");
            if (pSetting && pSetting.isShowing) {
              const pcs = pSetting.Parts?.find(p => p.constructor.name === 'PartCharacterSettingSkill');
              if (pcs) {
                if (pcs.refreshAll) pcs.refreshAll();
                if (pcs.rebuildSkillList) pcs.rebuildSkillList();
                if (pcs.refreshListStates) pcs.refreshListStates();
              }
            }
            const pChar = nn.ui.manager.getPanel("PanelCharacter");
            if (pChar && pChar.isShowing) {
              const pcs = pChar._partCharacter?.Parts?.find(p => p.constructor.name === 'PartCharSkill');
              if (pcs && pcs.refreshSkills) pcs.refreshSkills();
            }
          } catch(e) {}

          return { success: true, count: equippedSkills.length, skills: equippedSkills };
        } catch(err) {
          return { error: err.toString() };
        }
      }

      // === JEWEL FORGE & STORAGE PROCESSOR + QUERY ===
      let jewelData = {
        jewels: [],
        storageUsed: 0,
        storageTotal: 42,
        includeStorage: false,
        fusedHistory: [],
        depositedCount: 0,
        withdrawnCount: 0
      };

      try {
        let sWorkshop, sStorage, sEquip;
        for (let [k, v] of nn.services._mapService.entries()) {
          const name = k.name || k.toString();
          if (name === 'ServiceWorkshop') sWorkshop = v;
          if (name === 'ServiceStorage') sStorage = v;
          if (name === 'ServiceEquipment' || name === 'ServiceEquip') sEquip = v;
        }

        const resolveItemLevel = (itemTid, itemId) => {
          try {
            if (sWorkshop && typeof sWorkshop.getTableInfo === 'function') {
              const info = sWorkshop.getTableInfo(itemTid, itemId);
              if (info && info.baseLimitLevel > 0) return info.baseLimitLevel;
            }
          } catch(e) {}
          try {
            const dbEq = nn.db.equip.get(itemTid);
            if (dbEq && dbEq.LimitLevel !== undefined) return dbEq.LimitLevel;
          } catch(e) {}
          try {
            const dbIt = nn.db.item.get(itemTid);
            if (dbIt && dbIt.LimitLevel !== undefined) return dbIt.LimitLevel;
          } catch(e) {}
          return 1;
        };

        const calcTotalStorage = (items, slotPerTab) => {
          slotPerTab = slotPerTab || nn.db.config?.gen?.Storage_Slot_Cnt || 42;
          let detectedTabs = 1;
          if (cfg && cfg.manualWarehouseTabs && cfg.manualWarehouseTabs !== 'auto') {
            const p = parseInt(cfg.manualWarehouseTabs, 10);
            if (!isNaN(p) && p >= 1) detectedTabs = p;
          }
          if (cfg && cfg.savedWarehouseTabs && cfg.savedWarehouseTabs > detectedTabs) {
            detectedTabs = cfg.savedWarehouseTabs;
          }
          try {
            let sCount = 0;
            if (sStorage) {
              if (typeof sStorage.getStorageCount === 'function') sCount = sStorage.getStorageCount();
              else if (typeof sStorage.getWarehouseCount === 'function') sCount = sStorage.getWarehouseCount();
              else if (sStorage.storageCount) sCount = sStorage.storageCount;
              else if (sStorage._storageCount) sCount = sStorage._storageCount;
            }
            if (!sCount && userC && userC._user) {
              sCount = userC._user._storageCount || userC._user._warehouseCount || userC._user._storageTabCount || 0;
            }
            if (!sCount && itemC) {
              sCount = itemC._storageCount || itemC._warehouseCount || itemC._storageTabCount || 0;
            }
            if (sCount > detectedTabs) detectedTabs = sCount;
          } catch(e) {}

          const storageItems = (items || []).filter(i => i.location === 2);
          for (let it of storageItems) {
            const s = it.slotIdx !== undefined ? it.slotIdx : (it.slot !== undefined ? it.slot : (it._slotIdx !== undefined ? it._slotIdx : -1));
            if (s >= 0) {
              const tab = Math.floor(s / slotPerTab) + 1;
              if (tab > detectedTabs) detectedTabs = tab;
            }
          }
          return detectedTabs * slotPerTab;
        };

        // Execute pending action if requested
        manualEquipWeapons = false;
        manualEquipSkills = false;
        const cmd = globalThis.__pendingJewelCmd;
        if (cmd) {
          globalThis.__pendingJewelCmd = null;
          if (cmd.action === 'toggleStorage' && sWorkshop) {
            sWorkshop.setAutoRegisterIncludeStorage('Fusion', !!cmd.includeStorage);
          } else if (cmd.action === 'fuseT3' && sWorkshop) {
            // Ensure fusion allows storage candidates (Kho 1, 2, 3)
            sWorkshop.setAutoRegisterIncludeStorage('Fusion', true);

            // Helper function to collect clean candidate items for Gear (contentType=1) or Accessories (contentType=2)
            const collectT3Candidates = (targetContentType) => {
              return sWorkshop.collectAutoRegisterCandidates(
                'Fusion',
                (itemTid, itemId) => {
                  const live = nn.net.data.item.getItemNotStackUniqueId(itemId);
                  if (!live || live.isLock) return false;
                  if (nn.services.itemMove.isEquippedItemId(itemId)) return false;
                  if (nn.services.steamMarket?.staging?.isStaged(itemId)) return false;
                  return true;
                },
                true,
                { rating: 3 }
              ).filter(c => {
                if (c.ratingType !== 3) return false;
                const info = sWorkshop.getTableInfo(c.itemTid, c.itemId);
                return info && info.contentType === targetContentType;
              }).map(c => {
                c._itemLevel = c.baseLimitLevel || resolveItemLevel(c.itemTid, c.itemId) || 1;
                return c;
              });
            };

            // Fuse Tier 3 Gear (requires 6 items from Balo or Kho 1, 2, 3)
            if (cmd.fuseGear) {
              sWorkshop.setFusionContentType(1); // 1 = Gear
              sWorkshop.setAutoRegisterRating('Fusion', 3); // Tier 3
              const isSameLv = cmd.sameLevelOnly !== undefined ? cmd.sameLevelOnly : (cfg && cfg.sameLevelOnly);
              let loopGuard = 0;
              while (loopGuard < 20) {
                const candidates = collectT3Candidates(1);
                if (candidates.length < 6) break;

                let selectedItems = null;
                if (isSameLv) {
                  const byLevel = new Map();
                  for (let c of candidates) {
                    const lv = c._itemLevel;
                    if (!byLevel.has(lv)) byLevel.set(lv, []);
                    byLevel.get(lv).push(c);
                  }
                  const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => b - a);
                  for (let lv of sortedLevels) {
                    const grp = byLevel.get(lv);
                    if (grp.length >= 6) {
                      selectedItems = grp.slice(0, 6);
                      break;
                    }
                  }
                  if (!selectedItems) break; // No level group has 6 items!
                } else {
                  selectedItems = candidates.slice(0, 6);
                }

                const maxLv = Math.max(...selectedItems.map(i => i._itemLevel || 1));
                const targetTable = sWorkshop.findFusionTable(1, 3, maxLv);
                if (!targetTable) break;

                const materials = selectedItems.map(i => ({
                  itemId: i.itemId,
                  itemTid: i.itemTid,
                  itemCnt: 1
                }));

                if (!sWorkshop.validateFusionMaterials(targetTable, materials)) {
                  break;
                }

                sWorkshop.clearFusionStaging();
                const fusionRes = await sWorkshop.reqFusionAsync(targetTable.FusionID, materials);
                if (fusionRes && (fusionRes.NetResult === 0 || !fusionRes.NetResult || fusionRes.Data)) {
                  loopGuard++;
                  let rName = '';
                  try {
                    if (fusionRes.Data) {
                      const rewards = sWorkshop.buildFusionRewards(fusionRes.Data, 1);
                      if (rewards && rewards.length > 0) {
                        const rTid = rewards[0].tid;
                        const rInfo = nn.db.equip.get(rTid) || nn.db.item.get(rTid);
                        const rLoc = nn.db.locale.get(rInfo?.ItemName);
                        rName = rLoc?.VI || rLoc?.EN || rInfo?.ItemName || ('Trang bị TID ' + rTid);
                      }
                    }
                  } catch(e) {}
                  jewelData.fusedHistory.push('🛡️ Ghép T3 (Balo & Kho): ' + (rName || 'Thành công'));
                  nn.msgBroker.publish('onUpdateWorkShopFusion');
                } else {
                  break;
                }
              }
            }
            // Fuse Tier 3 Accessories (requires 3 items from Balo or Kho 1, 2, 3)
            if (cmd.fuseAcc) {
              sWorkshop.setFusionContentType(2); // 2 = Accessory / Trang sức
              sWorkshop.setAutoRegisterRating('Fusion', 3); // Tier 3
              const isSameLv = cmd.sameLevelOnly !== undefined ? cmd.sameLevelOnly : (cfg && cfg.sameLevelOnly);
              let loopGuard = 0;
              while (loopGuard < 20) {
                const candidates = collectT3Candidates(2);
                if (candidates.length < 3) break;

                let selectedItems = null;
                if (isSameLv) {
                  const byLevel = new Map();
                  for (let c of candidates) {
                    const lv = c._itemLevel;
                    if (!byLevel.has(lv)) byLevel.set(lv, []);
                    byLevel.get(lv).push(c);
                  }
                  const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => b - a);
                  for (let lv of sortedLevels) {
                    const grp = byLevel.get(lv);
                    if (grp.length >= 3) {
                      selectedItems = grp.slice(0, 3);
                      break;
                    }
                  }
                  if (!selectedItems) break; // No level group has 3 accessories!
                } else {
                  selectedItems = candidates.slice(0, 3);
                }

                const maxLv = Math.max(...selectedItems.map(i => i._itemLevel || 1));
                const targetTable = sWorkshop.findFusionTable(2, 3, maxLv);
                if (!targetTable) break;

                const materials = selectedItems.map(i => ({
                  itemId: i.itemId,
                  itemTid: i.itemTid,
                  itemCnt: 1
                }));

                if (!sWorkshop.validateFusionMaterials(targetTable, materials)) {
                  break;
                }

                sWorkshop.clearFusionStaging();
                const fusionRes = await sWorkshop.reqFusionAsync(targetTable.FusionID, materials);
                if (fusionRes && (fusionRes.NetResult === 0 || !fusionRes.NetResult || fusionRes.Data)) {
                  loopGuard++;
                  let rName = '';
                  try {
                    if (fusionRes.Data) {
                      const rewards = sWorkshop.buildFusionRewards(fusionRes.Data, 2);
                      if (rewards && rewards.length > 0) {
                        const rTid = rewards[0].tid;
                        const rInfo = nn.db.equip.get(rTid) || nn.db.item.get(rTid);
                        const rLoc = nn.db.locale.get(rInfo?.ItemName);
                        rName = rLoc?.VI || rLoc?.EN || rInfo?.ItemName || ('Trang sức TID ' + rTid);
                      }
                    }
                  } catch(e) {}
                  jewelData.fusedHistory.push('💍 Ghép T3 (Balo & Kho): ' + (rName || 'Thành công'));
                  nn.msgBroker.publish('onUpdateWorkShopFusion');
                } else {
                  break;
                }
              }
            }
          } else if (cmd.action === 'fuse' && sWorkshop) {
            sWorkshop.setFusionContentType(20);
            sWorkshop.setAutoRegisterIncludeStorage('Fusion', cmd.includeStorage !== false);
            const targetTiers = cmd.allowedTiers || (cmd.tier ? [cmd.tier] : [1, 2, 3, 4, 5, 6, 7]);
            for (let t of targetTiers) {
              sWorkshop.setAutoRegisterRating('Fusion', t);
              let loopGuard = 0;
              while (loopGuard < 20) {
                const regCnt = sWorkshop.autoRegisterFusion();
                if (!regCnt || !sWorkshop.isFusionStagingFull()) {
                  sWorkshop.clearFusionStaging();
                  break;
                }
                const fusionRes = await sWorkshop.reqFusionStagedAsync();
                if (fusionRes && fusionRes.length > 0) {
                  loopGuard++;
                  const rTid = fusionRes[0].tid;
                  const rInfo = nn.db.item.get(rTid);
                  const rLoc = nn.db.locale.get(rInfo?.ItemName);
                  const rName = rLoc?.VI || rLoc?.EN || rInfo?.ItemName || ('TID ' + rTid);
                  jewelData.fusedHistory.push(rName);
                } else {
                  sWorkshop.clearFusionStaging();
                  break;
                }
              }
            }
          } else if (cmd.action === 'deposit') {
            const gs = nn.net.manager.gameSession;
            const allItems = nn.net.data.item.getAllItemNotStack();
            const toDeposit = [];
            for (let it of allItems) {
              if (it.location === 1 && !it.isLock) { // 1 = Inventory (Balo)
                const dbInfo = nn.db.item.get(it.itemTid);
                if (dbInfo && dbInfo.ItemType === 6) { // Jewel
                  toDeposit.push(it.itemId);
                }
              }
            }
            if (toDeposit.length > 0) {
              const totalStorage = calcTotalStorage(allItems);
              const usedStorage = allItems.filter(i => i.location === 2).length; // 2 = Storage (Kho)
              const avail = Math.max(0, totalStorage - usedStorage);
              const chunk = toDeposit.slice(0, avail);
              if (chunk.length > 0) {
                await gs.reqStorageMoveInList(chunk);
                jewelData.depositedCount = chunk.length;
              }
            }
          } else if (cmd.action === 'withdraw') {
            const gs = nn.net.manager.gameSession;
            const allItems = nn.net.data.item.getAllItemNotStack();
            const toWithdraw = [];
            for (let it of allItems) {
              if (it.location === 2 && !it.isLock) { // 2 = Storage (Kho)
                const dbInfo = nn.db.item.get(it.itemTid);
                if (dbInfo && dbInfo.ItemType === 6) { // Jewel
                  toWithdraw.push(it.itemId);
                }
              }
            }
            if (toWithdraw.length > 0) {
              await gs.reqStorageMoveOutList(toWithdraw);
              jewelData.withdrawnCount = toWithdraw.length;
            }
          } else if (cmd.action === 'depositType') {
            const gs = nn.net.manager.gameSession;
            const allItems = nn.net.data.item.getAllItemNotStack();
            const toDeposit = [];
            for (let it of allItems) {
              if (it.location === 1 && !it.isLock && it.itemTid === cmd.itemTid) {
                toDeposit.push(it.itemId);
              }
            }
            if (toDeposit.length > 0) {
              const totalStorage = calcTotalStorage(allItems);
              const usedStorage = allItems.filter(i => i.location === 2).length;
              const avail = Math.max(0, totalStorage - usedStorage);
              const chunk = toDeposit.slice(0, avail);
              if (chunk.length > 0) {
                await gs.reqStorageMoveInList(chunk);
                jewelData.depositedCount = chunk.length;
              }
            }
          } else if (cmd.action === 'withdrawType') {
            const gs = nn.net.manager.gameSession;
            const allItems = nn.net.data.item.getAllItemNotStack();
            const toWithdraw = [];
            for (let it of allItems) {
              if (it.location === 2 && !it.isLock && it.itemTid === cmd.itemTid) {
                toWithdraw.push(it.itemId);
              }
            }
            if (toWithdraw.length > 0) {
              await gs.reqStorageMoveOutList(toWithdraw);
              jewelData.withdrawnCount = toWithdraw.length;
            }
          } else if (cmd.action === 'equipClassWeapons') {
            manualEquipWeapons = true;
          } else if (cmd.action === 'equipClassSkills') {
            manualEquipSkills = true;
          }
        }

        autoEquipWeaponRes = null;
        autoEquipSkillRes = null;

        const shouldEquipWeapons = (classSwitched && cfg && cfg.autoEquipWeapon) || manualEquipWeapons;
        if (shouldEquipWeapons) {
          autoEquipWeaponRes = await autoEquipBestWeaponsForClass(heroClassType);
        }

        const shouldEquipSkills = (classSwitched && cfg && cfg.autoEquipSkill) || manualEquipSkills;
        if (shouldEquipSkills) {
          autoEquipSkillRes = await autoEquipSkillsForClass(heroClassType);
        }

        // Query jewels & storage state
        const allNotStack = nn.net.data.item.getAllItemNotStack();
        jewelData.storageTotal = calcTotalStorage(allNotStack);
        jewelData.storageUsed = allNotStack.filter(i => i.location === 2).length; // 2 = Kho đồ
        jewelData.includeStorage = sWorkshop ? sWorkshop.getAutoRegisterIncludeStorage('Fusion') : false;

        // Count Tier 3 items in inventory (location 1) AND storage (Kho 1, 2, 3, location 2)
        let t3GearInv = 0;
        let t3GearStorage = 0;
        let t3AccInv = 0;
        let t3AccStorage = 0;
        const t3GearByLevel = {};
        const t3AccByLevel = {};

        for (let it of allNotStack) {
          if (!it.isLock && (it.location === 1 || it.location === 2)) {
            const dbEquip = nn.db.equip.get(it.itemTid);
            if (dbEquip && dbEquip.RatingType === 3) {
              const isGear = dbEquip.EquipType === 1 || (dbEquip.PartsType && dbEquip.PartsType <= 8);
              const isAcc = dbEquip.EquipType === 2 || (dbEquip.PartsType && dbEquip.PartsType >= 9);
              const itemLv = resolveItemLevel(it.itemTid, it.itemId);
              if (isGear) {
                if (it.location === 1) t3GearInv++;
                else if (it.location === 2) t3GearStorage++;
                t3GearByLevel[itemLv] = (t3GearByLevel[itemLv] || 0) + 1;
              } else if (isAcc) {
                if (it.location === 1) t3AccInv++;
                else if (it.location === 2) t3AccStorage++;
                t3AccByLevel[itemLv] = (t3AccByLevel[itemLv] || 0) + 1;
              }
            }
          }
        }
        jewelData.t3GearCount = t3GearInv + t3GearStorage;
        jewelData.t3GearInvCount = t3GearInv;
        jewelData.t3GearStorageCount = t3GearStorage;
        jewelData.t3GearMaxSameLevel = Math.max(0, ...Object.values(t3GearByLevel));
        jewelData.t3GearReadySameLevel = Object.values(t3GearByLevel).reduce((acc, cnt) => acc + Math.floor(cnt / 6), 0);

        jewelData.t3AccCount = t3AccInv + t3AccStorage;
        jewelData.t3AccInvCount = t3AccInv;
        jewelData.t3AccStorageCount = t3AccStorage;
        jewelData.t3AccMaxSameLevel = Math.max(0, ...Object.values(t3AccByLevel));
        jewelData.t3AccReadySameLevel = Object.values(t3AccByLevel).reduce((acc, cnt) => acc + Math.floor(cnt / 3), 0);

        for (let it of allNotStack) {
          const dbInfo = nn.db.item.get(it.itemTid);
          if (dbInfo && dbInfo.ItemType === 6) {
            const loc = nn.db.locale.get(dbInfo.ItemName);
            jewelData.jewels.push({
              itemId: it.itemId.toString(),
              itemTid: it.itemTid,
              name: loc?.VI || loc?.EN || dbInfo.ItemName,
              rating: dbInfo.RatingType,
              icon: dbInfo.Icon || dbInfo.ItemIcon || '',
              location: it.location, // 1: Balo, 2: Kho đồ, 3: Đang khảm
              slot: it.slotIdx,
              isLock: it.isLock
            });
          }
        }
      } catch(je) {
        jewelData.error = je.toString();
      }

      // === LIVE EQUIPPED GEAR QUERY ===
      let equippedGear = [];
      try {
        const allItems = nn.net.data.item.getAllItemNotStack();
        const equipped = allItems.filter(i => i.location === 3); // 3 = Equipped on hero
        for (let it of equipped) {
          const dbEquip = nn.db.equip.get(it.itemTid);
          const dbItem = nn.db.item.get(it.itemTid);
          const loc = dbEquip ? nn.db.locale.get(dbEquip.ItemName) : (dbItem ? nn.db.locale.get(dbItem.ItemName) : null);
          const name = loc?.VI || loc?.EN || dbEquip?.ItemName || dbItem?.ItemName || ('ID ' + it.itemTid);
          const partsType = dbEquip ? dbEquip.PartsType : 0;
          const equipType = dbEquip ? dbEquip.EquipType : 1;
          const ratingType = dbEquip ? dbEquip.RatingType : (dbItem ? dbItem.RatingType : 1);
          const icon = dbEquip ? (dbEquip.Icon || dbEquip.ItemIcon || '') : (dbItem ? (dbItem.Icon || dbItem.ItemIcon || '') : '');
          equippedGear.push({
            id: it.itemId.toString(),
            tid: it.itemTid,
            slot: it.slotIdx,
            parts_type: partsType,
            equip_type: equipType,
            name_vi: name,
            tier: ratingType,
            icon: icon
          });
        }
      } catch(eqErr) {
        // ignore
      }

      // === STAGE RUN HISTORY TRACKER ===
      if (!globalThis.__stageTracker) {
        globalThis.__stageTracker = {
          currentRun: null,
          completedRuns: [],
          lastRecordedGameId: null
        };
      }
      let stageRunHistory = [];
      let currentStageRun = null;
      try {
        const sTracker = globalThis.__stageTracker;
        const curProxy = sCombat ? sCombat.getCurrentActiveCombatProxy() : null;
        const heroPawn = curProxy ? curProxy.getMyHeroPawn() : null;
        let sStageInst = null;
        for (let [k, v] of nn.services._mapService.entries()) {
          const sName = k.name || k.toString();
          if (sName === 'ServiceStage') sStageInst = v;
        }
        const activeStageTid = (sStageInst && sStageInst.playingStageTid) ? sStageInst.playingStageTid : ((sStageInst && sStageInst.stageTid) ? sStageInst.stageTid : (curProxy ? curProxy.fieldTid : stageTid));
        const curClearTid = (sStageInst && sStageInst.stageInfo) ? sStageInst.stageInfo._clearStageTid : clearStageTid;
        const isHeroDead = heroPawn ? (heroPawn._isDead || heroPawn._isAlive === false || (heroPawn._curHp !== undefined && heroPawn._curHp <= 0)) : false;
        const isClearSeqStarted = curProxy ? !!curProxy._bStageClearSequenceStarted : false;
        const isGameEnd = curProxy ? (!!curProxy._isGameEnd || curProxy._gameState === 4 || curProxy._gameState === 5) : false;
        const curElapsed = curProxy ? (curProxy.elapsedTime || 0) : 0;
        const curGameId = curProxy ? curProxy._gameId : null;
        const nowTs = Date.now();

        if (sTracker.currentRun) {
          const cur = sTracker.currentRun;
          const sameGame = curGameId && cur.gameId ? (curGameId === cur.gameId) : (curProxy && curProxy.fieldTid === cur.stageId);
          
          if (sameGame) {
            cur.duration = curElapsed > 0 ? curElapsed : ((nowTs - cur.startTime) / 1000);
            if (isHeroDead) cur.wasHeroDead = true;
            if (isClearSeqStarted) cur.wasClearSeqStarted = true;
            if (curClearTid > cur.initialClearTid) cur.clearedNewStage = true;
          }

          const battleEnded = (!sameGame && curGameId) || isGameEnd || isClearSeqStarted || cur.wasHeroDead || !curProxy || (activeStageTid !== cur.stageId && activeStageTid !== 0);

          if (battleEnded && !cur.recorded && cur.duration >= 1) {
            const isShort = cur.duration < 6.0;
            let runStatus = 'success';
            if (cur.wasHeroDead) {
              runStatus = 'failed';
            } else if (cur.isPartial || isShort) {
              runStatus = 'partial';
            } else if (cur.wasClearSeqStarted || cur.clearedNewStage) {
              runStatus = 'success';
            } else if (!curProxy || (activeStageTid !== cur.stageId && activeStageTid !== 0)) {
              runStatus = 'abandoned';
            } else if (isGameEnd) {
              runStatus = cur.duration >= 6.0 ? 'success' : 'abandoned';
            }

            cur.recorded = true;
            if (cur.gameId) sTracker.lastRecordedGameId = cur.gameId;

            sTracker.completedRuns.unshift({
              stage_id: cur.stageId,
              status: runStatus,
              duration: Math.max(1, Math.round(cur.duration * 10) / 10),
              timestamp: nowTs,
              isPartial: cur.isPartial || isShort
            });
            if (sTracker.completedRuns.length > 100) {
              sTracker.completedRuns = sTracker.completedRuns.slice(0, 100);
            }
            sTracker.currentRun = null;
          }
        }

        if (!sTracker.currentRun && curProxy && activeStageTid > 0 && !isGameEnd && !isHeroDead) {
          if (!curGameId || curGameId !== sTracker.lastRecordedGameId) {
            const isMidCombat = (curElapsed >= 2.0 || (curProxy._gameState === 3 && curElapsed >= 1.5));
            sTracker.currentRun = {
              gameId: curGameId || null,
              stageId: activeStageTid,
              startTime: nowTs,
              duration: curElapsed > 0 ? curElapsed : 0,
              wasHeroDead: false,
              wasClearSeqStarted: false,
              clearedNewStage: false,
              initialClearTid: curClearTid,
              recorded: false,
              isPartial: isMidCombat
            };
            if (globalThis.__liveCombatTracker) {
              globalThis.__liveCombatTracker.totalDamage = 0;
              globalThis.__liveCombatTracker.normalDamage = 0;
              globalThis.__liveCombatTracker.skillDamage = 0;
              globalThis.__liveCombatTracker.hitCount = 0;
              globalThis.__liveCombatTracker.startTime = nowTs;
            }
          }
        }

        // Live Combat Damage Tracking Hook
        if (curProxy && curProxy._combatController && !curProxy._combatController.__dmgHooked) {
          curProxy._combatController.__dmgHooked = true;
          const origShow = curProxy._combatController.showDamageText;
          if (!globalThis.__liveCombatTracker) {
            globalThis.__liveCombatTracker = { totalDamage: 0, normalDamage: 0, skillDamage: 0, hitCount: 0, startTime: nowTs };
          }
          curProxy._combatController.showDamageText = function(pos, damage, damageType) {
            try {
              const dmg = typeof damage === 'number' ? damage : (damage ? parseFloat(damage) : 0);
              if (dmg > 0) {
                const tr = globalThis.__liveCombatTracker;
                tr.totalDamage += dmg;
                tr.hitCount++;
                if (damageType === 2 || damageType === 4) {
                  tr.normalDamage += dmg;
                } else {
                  tr.skillDamage += dmg;
                }
              }
            } catch(e) {}
            return origShow.apply(this, arguments);
          };
        }

        stageRunHistory = sTracker.completedRuns.slice(0, 100);
        currentStageRun = sTracker.currentRun ? {
          stage_id: sTracker.currentRun.stageId,
          duration: Math.max(0.1, Math.round((curElapsed > 0 ? curElapsed : ((nowTs - sTracker.currentRun.startTime) / 1000)) * 10) / 10),
          status: 'running',
          timestamp: sTracker.currentRun.startTime
        } : null;
      } catch(stErr) {}

      // === AUTO CONFIRM RECONNECT ON NETWORK ERROR ===
      let autoReconnectResult = null;
      try {
        if (cfg && cfg.autoReconnectConfirm) {
          const sysPopup = nn.ui && nn.ui.manager && nn.ui.manager.getPanel ? nn.ui.manager.getPanel("PanelSystemPopup") : null;
          if (sysPopup && sysPopup.ArrBtn && (sysPopup._isShowing || sysPopup.isShowing)) {
            const title = (sysPopup.TxtTitle?.text || '').trim();
            const errorMsg = (sysPopup.TxtErrorMessage?.text || '').trim();
            const combined = (title + ' ' + errorMsg).toLowerCase();

            const isNetError = combined.includes('kết nối') || 
                               combined.includes('máy chủ') || 
                               combined.includes('reconnect') || 
                               combined.includes('connection') || 
                               combined.includes('server') || 
                               combined.includes('재접속') || 
                               combined.includes('네트워크') || 
                               combined.includes('network');

            if (isNetError) {
              const len = sysPopup.ArrBtn.Length !== undefined ? sysPopup.ArrBtn.Length : (sysPopup.ArrBtn.length || 0);
              for (let i = 0; i < len; i++) {
                const btn = sysPopup.ArrBtn.get_Item ? sysPopup.ArrBtn.get_Item(i) : sysPopup.ArrBtn[i];
                if (!btn) continue;
                const isActive = btn.gameObject ? (btn.gameObject.activeSelf ?? true) : true;
                if (!isActive) continue;

                const btnText = (btn.Text?.text || '').trim();
                const lowerText = btnText.toLowerCase();

                if (btnText === 'Xác nhận' || 
                    btnText === 'Confirm' || 
                    btnText === 'OK' || 
                    lowerText === 'xác nhận' || 
                    lowerText === 'confirm' || 
                    lowerText === 'ok' || 
                    btnText === '확인' || 
                    btnText === '确认' || 
                    btnText === '確認') {
                  if (btn.onClick && typeof btn.onClick.Invoke === 'function') {
                    btn.onClick.Invoke();
                    autoReconnectResult = {
                      handled: true,
                      buttonText: btnText,
                      title: title,
                      message: errorMsg
                    };
                    break;
                  }
                }
              }
            }
          }
        }
      } catch(e) {
        autoReconnectResult = { error: e.toString() };
      }

      return JSON.stringify({
        nickname: userC && userC._user ? userC._user._nick : 'Lee',
        level: userC && userC._user ? userC._user._lv : 33,
        combatPower: (function() {
          try {
            let scp = null;
            for (let [k, v] of nn.services._mapService.entries()) {
              if (k.name === 'ServiceCombatPower' || k.toString() === 'ServiceCombatPower') scp = v;
            }
            if (scp && scp._beforeCombatPower) return Math.round(parseFloat(scp._beforeCombatPower)).toString();
            if (userC && userC._profile && userC._profile._combatPower) return userC._profile._combatPower.toString();
          } catch(e) {}
          return '26175';
        })(),
        stageTid: stageTid,
        clearStageTid: clearStageTid,
        maxUnlockedStageTid: maxUnlockedStageTid,
        currencies: currencies,
        expInfo: expInfo,
        deployedSkills: mySkills,
        liveSkillLevels: liveSkillLevels,
        trainingSkills: trainingSkills,
        heroClass: heroClass,
        heroClassType: heroClassType,
        classSwitched: classSwitched,
        prevClassType: prevClassType,
        autoEquipWeaponRes: autoEquipWeaponRes,
        autoEquipSkillRes: autoEquipSkillRes,
        autoReconnectResult: autoReconnectResult,
        jewelsData: jewelData,
        equippedGear: equippedGear,
        stageRunHistory: stageRunHistory,
        currentStageRun: currentStageRun,
        liveCombatTracker: globalThis.__liveCombatTracker || null,
        stats: stats
      });
    } catch(err) {
      return JSON.stringify({ error: err.toString() });
    }
    }).toString() + ')(' + JSON.stringify(getPollConfig()) + ')';

    evaluate(code, { awaitPromise: true, returnByValue: true });
  }

  return {
    start,
    stop,
    toggle,
    isRunning: function () { return isActive; },
    kickoff,
    pollNow,
    evaluate,
    triggerSteamRelaunch,
    setAutoRelaunch: function (v) { isAutoRelaunchActive = !!v; },
    isAutoRelaunchEnabled: function () { return isAutoRelaunchActive; },
    setPollConfigProvider: function (fn) { if (typeof fn === 'function') getPollConfig = fn; },
    onData: function (fn) { dataHandler = fn || function(){}; },
    onStatus: function (fn) { statusHandler = fn || function(){}; },
    onConnect: function (fn) { connectHandler = fn || function(){}; },
    onDisconnect: function (fn) { disconnectHandler = fn || function(){}; }
  };
})();
