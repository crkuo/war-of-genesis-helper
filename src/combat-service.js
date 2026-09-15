// CombatService: pure DPS/combat-math calculations.
//
// Boundary: this module takes the character's stats/skill state and returns numbers —
// it never touches the DOM. renderCombatBreakdown() (in the main script) calls
// CombatService.computeDpsBreakdown() and is responsible for everything after that:
// writing the numbers into the page and driving the rest of the DPS panel's UI flow
// (snapshots, comparison table, live ticker).
window.CombatService = (function () {
  'use strict';

  function getPlayerLevel() {
    return userProfile.level || 32;
  }

  // Active Skills config per class with verified in-game icons (damage % / cooldown
  // fall back to these defaults when skillTrees has no data for the character's
  // current level).
  function buildClassSkillsConfig(getLiveLevel) {
    return {
      Ranged: [
        { id: 8201010, groupId: 8201010, name: 'Đòn Phủ Đầu (First Strike)', mult: 280, cd: 20, lv: getLiveLevel(8201010), isAoe: false, icon: 'active_rapidfire', emoji: '🏹', color: '#e3b341' },
        { id: 8202050, groupId: 8202010, name: 'Bắn Nhanh (Rapid Fire)', mult: 396, cd: 26, lv: getLiveLevel(8202010), isAoe: false, icon: 'active_barrage', emoji: '🏹', color: '#bc8cff' },
        { id: 8203030, groupId: 8203010, name: 'Kẻ Quan Sát (Watcher)', mult: 336, cd: 24, lv: getLiveLevel(8203010), isAoe: false, icon: 'active_overwatchmode', emoji: '👁️', color: '#7ee787' },
        { id: 8208040, groupId: 8208010, name: 'Mưa Tên (Arrow Rain)', mult: 400, cd: 25, lv: getLiveLevel(8208010), isAoe: true, icon: 'active_rainoffire', emoji: '🌧️', color: '#ffa657' },
        { id: 8209050, groupId: 8209010, name: 'Tên Đá (Stone Arrow)', mult: 432, cd: 24, lv: getLiveLevel(8209010), isAoe: false, icon: 'active_acidthrow', emoji: '🪨', color: '#f85149' },
        { id: 8210010, groupId: 8210010, name: 'Bắn Độc (Poisoned)', mult: 260, cd: 22, lv: getLiveLevel(8210010), isAoe: false, icon: 'active_alertposture', emoji: '☠️', color: '#7ee787' }
      ],
      Melee: [
        { id: 8101010, groupId: 8101010, name: 'Đòn Đao Phủ (Executioner)', mult: 260, cd: 20, lv: getLiveLevel(8101010), isAoe: false, icon: 'active_beheadmoon_07', emoji: '⚔️', color: '#e3b341' },
        { id: 8102050, groupId: 8102010, name: 'Chém Trăng Khuyết (Moon Cleave)', mult: 350, cd: 20, lv: getLiveLevel(8102010), isAoe: false, icon: 'active_allyprotection', emoji: '🌙', color: '#bc8cff' },
        { id: 8103020, groupId: 8103010, name: 'Hỏa Trận (Formation Flame)', mult: 220, cd: 26, lv: getLiveLevel(8103010), isAoe: true, icon: 'active_godkillingspear', emoji: '🔥', color: '#ffa657' },
        { id: 8108050, groupId: 8108010, name: 'Thần Thương (Divine Spear)', mult: 380, cd: 20, lv: getLiveLevel(8108010), isAoe: true, icon: 'active_prolongedpainslash_02', emoji: '🔱', color: '#f85149' },
        { id: 8109020, groupId: 8109010, name: 'Xung Kích (Shield Charge)', mult: 280, cd: 22, lv: getLiveLevel(8109010), isAoe: false, icon: 'active_thornsbarricade', emoji: '🛡️', color: '#7ee787' },
        { id: 8104010, groupId: 8104010, name: 'Chém Trăng (Moon Slash)', mult: 270, cd: 25, lv: getLiveLevel(8104010), isAoe: false, icon: 'active_beheadmoon_11', emoji: '🌙', color: '#bc8cff' }
      ],
      Mage: [
        { id: 8301030, groupId: 8301010, name: 'Cầu Lửa (Fireball)', mult: 360, cd: 18, lv: getLiveLevel(8301010), isAoe: false, icon: 'active_darkblast', emoji: '🔥', color: '#ffa657' },
        { id: 8302050, groupId: 8302010, name: 'Bão Lửa (Flame Storm)', mult: 520, cd: 24, lv: getLiveLevel(8302010), isAoe: true, icon: 'active_flamestorm', emoji: '🌪️', color: '#f85149' },
        { id: 8303050, groupId: 8303010, name: 'Điểm Dị Thường (Singularity)', mult: 420, cd: 26, lv: getLiveLevel(8303010), isAoe: false, icon: 'active_indiscriminationshot', emoji: '🌀', color: '#bc8cff' },
        { id: 8308030, groupId: 8308010, name: 'Tia Sét Ma Pháp (Lightning)', mult: 380, cd: 20, lv: getLiveLevel(8308010), isAoe: false, icon: 'active_holyblow', emoji: '⚡', color: '#e3b341' },
        { id: 8309030, groupId: 8309010, name: 'Hố Đen Hủy Diệt (Dark Matter)', mult: 460, cd: 28, lv: getLiveLevel(8309010), isAoe: true, icon: 'active_firearrow', emoji: '🌌', color: '#58a6ff' },
        { id: 8310010, groupId: 8310010, name: 'Đầm Lầy Dung Nham (Lava Swamp)', mult: 280, cd: 22, lv: getLiveLevel(8310010), isAoe: true, icon: 'active_lavaflip', emoji: '🌋', color: '#ff7b72' }
      ]
    };
  }

  // Reads character stats + current class/mode/skill levels from app globals and
  // returns the full DPS breakdown: normal-attack stats, per-skill DPS, and the
  // combined ranking used by both the DPS table and the Smart Analysis panel.
  // Deliberately pure — no document.* calls, no writes to window.__last*.
  function computeDpsBreakdown() {
    const st = (userProfile.stats && userProfile.stats.finalAttack) ? userProfile.stats : {
      finalAttack: 1337.6,
      finalAttackSpeed: 115.95,
      finalCriticalRate: 23.6,
      finalCriticalDamage: 192.7,
      damageBonus: 19.7,
      pveBonus: 32.5,
      bossBonus: 22.7
    };

    const atk = Number(st.finalAttack || 1337.6);
    const atkSpeed = Number(st.finalAttackSpeed || 115.95) / 100; // hits per sec
    const critRate = (st.finalCriticalRate !== undefined ? Number(st.finalCriticalRate) : 23.6) / 100;
    const critDmg = (st.finalCriticalDamage !== undefined ? Number(st.finalCriticalDamage) : 192.7) / 100;
    const generalDmg = (st.damageBonus !== undefined ? Number(st.damageBonus) : 19.7);
    const pveDmg = (st.pveBonus !== undefined ? Number(st.pveBonus) : 32.5);
    const bossDmg = (st.bossBonus !== undefined ? Number(st.bossBonus) : 22.7);

    // In PvE stage farming, total effective damage bonus combines general Damage Amp + PvE bonus (or Boss bonus if single target mode)
    const effDmgBonus = generalDmg + (dpsCombatMode === 'single' ? bossDmg : pveDmg);
    const dmgBonus = effDmgBonus / 100;

    const critMult = 1.0 + critRate * (critDmg - 1.0);
    const dmgMult = 1.0 + dmgBonus;
    const aoeMobMultiplier = (dpsCombatMode === 'aoe') ? 2.2 : 1.0;

    // Normal Attack Stats
    const normalHitDmg = atk * dmgMult * critMult;
    const normalDps = normalHitDmg * atkSpeed;
    const normalDpm = normalDps * 60;
    const normalHitsPerMin = atkSpeed * 60;

    // Dynamic skill level lookup from live game data
    function getLiveLevel(groupTid) {
      const live = userProfile.liveSkillLevels;
      if (live && live[groupTid]) return live[groupTid].level;
      // Fallback: check skillAllocations
      return skillAllocations[String(groupTid)] || 0;
    }

    const classSkillsConfig = buildClassSkillsConfig(getLiveLevel);
    const activeSkills = classSkillsConfig[currentDpsClass] || classSkillsConfig.Ranged;

    // Helper to dynamically get skill stats from skillTrees table for exact level
    function getSkillStatsForLevel(clsName, groupId, level) {
      const clsTree = skillTrees[clsName];
      if (clsTree) {
        for (let b of clsTree.branches) {
          for (let s of b.skills) {
            if (s.id === groupId) {
              const lvData = s.levels.find(l => l.level === level) || s.levels[0];
              return {
                damage_percent: lvData ? (lvData.damage_percent || 100) : 100,
                cooldown_sec: lvData ? (lvData.cooldown_sec || 20) : 20
              };
            }
          }
        }
      }
      return null;
    }

    let totalDps = normalDps;
    const processedSkills = activeSkills.map(function(s) {
      const curLv = s.lv > 0 ? s.lv : 1;
      const dynStats = getSkillStatsForLevel(currentDpsClass, s.groupId || s.id, curLv);
      const skillMult = dynStats ? dynStats.damage_percent : s.mult;
      const skillCd = dynStats ? dynStats.cooldown_sec : s.cd;

      const effMult = (s.isAoe && dpsCombatMode === 'aoe') ? (skillMult * aoeMobMultiplier) : skillMult;
      const castDmg = atk * (effMult / 100) * dmgMult * critMult;
      const castsPerMin = 60 / skillCd;
      const dps = castDmg / skillCd;
      const dpm = dps * 60;
      totalDps += dps;
      return {
        ...s,
        mult: skillMult,
        cd: skillCd,
        isNormal: false,
        singleCastDmg: atk * (skillMult / 100) * dmgMult * critMult,
        effCastDmg: castDmg,
        castsPerMin: castsPerMin,
        dps: dps,
        dpm: dpm
      };
    });

    // Normal Attack Object
    const normalObj = {
      id: 'normal',
      name: 'Đòn Đánh Thường (Normal Attack)',
      subName: 'Chém / Bắn cơ bản không tốn hồi chiêu',
      isNormal: true,
      lvStr: 'Cơ bản',
      multStr: '100% Công',
      cdStr: 'Không CD',
      castsPerMin: normalHitsPerMin,
      effCastDmg: normalHitDmg,
      dps: normalDps,
      dpm: normalDpm,
      isAoe: false,
      icon: 'attack_normal',
      emoji: '🗡️',
      color: '#58a6ff'
    };

    // Combine & Sort descending by DPS (từ dame cao đến dame thấp)
    const allCombatItems = [normalObj, ...processedSkills];
    allCombatItems.sort(function(a, b) {
      return b.dps - a.dps; // Sort descending from highest to lowest damage
    });

    const skillDpsTotal = processedSkills.reduce(function(acc, s) { return acc + (s.dps || 0); }, 0);
    const topSkillByDps = processedSkills.slice().sort(function(a,b){ return b.dps - a.dps; }).slice(0, 6);

    const dpsBreakdown = {
      totalDps: totalDps,
      normalDps: normalDps,
      skillDps: skillDpsTotal,
      attackSpeed: atkSpeed,
      critRate: critRate * 100,
      critDmg: critDmg * 100,
      dmgBonus: dmgBonus * 100,
      baseAtk: atk,
      skills: processedSkills.map(function(s) {
        return { name: s.name, dps: s.dps, cd: s.cd, mult: s.mult, lv: s.lv, groupId: s.groupId || s.id, isAoe: s.isAoe };
      }),
      topSkill: topSkillByDps[0] ? { name: topSkillByDps[0].name, dps: topSkillByDps[0].dps } : null,
      activeClass: currentDpsClass,
      skillsConfig: activeSkills.map(function(s) {
        return { groupId: s.groupId || s.id, name: s.name, lv: s.lv, maxLv: 10 };
      })
    };

    return {
      atk, atkSpeed, critRate, critDmg, critMult, dmgMult,
      generalDmg, pveDmg, bossDmg, effDmgBonus, dmgBonus, aoeMobMultiplier,
      normalHitDmg, normalDps, normalDpm, normalHitsPerMin,
      activeSkills, processedSkills, normalObj, allCombatItems, totalDps,
      skillDpsTotal, topSkillByDps, dpsBreakdown, getLiveLevel
    };
  }

  return { getPlayerLevel, computeDpsBreakdown };
})();
