// I18nService: the translation dictionary (Vietnamese source strings → English /
// Traditional Chinese) and the logic that applies it — reading/writing the current
// language, looking up a single string, and walking the live DOM to swap all
// translatable text/placeholders/titles.
//
// Boundary: this module owns everything that only needs "what language are we in"
// and "what's the translation for this source string." It does NOT own re-rendering
// the app's dynamic panels (DPS table, stage table, skill tree, ...) when the
// language changes — that orchestration stays in switchLanguage() in the main
// script, since it has to know about every feature panel in the app. Traditional
// Chinese currently covers only this static/DOM-driven layer (menus, buttons,
// tooltips, placeholders); the app's dynamically re-rendered panels still choose
// between Vietnamese and English via their own isEn checks and are unaffected by
// the 'zh' language — selecting it falls those panels back to Vietnamese.
window.I18nService = (function () {
  'use strict';

  const LANG_KEY = 'genesis_helper_lang';
  const LANGS = ['vi', 'en', 'zh'];

  // I18N_STRINGS is the maintained source of truth: one entry per UI string, keyed
  // by a stable identifier instead of the Vietnamese text itself. Keying by the raw
  // Vietnamese source string (as an earlier version of this dictionary did) is a typo
  // trap — a single wrong diacritic in a hand-typed key silently breaks that string's
  // lookup with no error, since the DOM walker just fails to find a match and leaves
  // the original text alone. `vi` here is *data* (the literal text baked into the
  // HTML, which applyToDOM matches against at runtime), not part of the key.
  const I18N_STRINGS = {
  support_me: { vi: '☕ Ủng Hộ Tác Giả', en: '☕ Support Me', zh: '☕ 贊助作者' },
  support_me_2: { vi: 'Ủng Hộ Tác Giả', en: 'Support Me', zh: '贊助作者' },
  support_the_developer_donate: { vi: 'Ủng Hộ Tác Giả / Support the Developer', en: 'Support the Developer / Donate', zh: '贊助開發者 / Support the Developer' },
  war_of_genesis_idle_loot_helper_100_free: { vi: 'War of Genesis Idle Loot Helper — 100% Miễn Phí & Phi Lợi Nhuận', en: 'War of Genesis Idle Loot Helper — 100% Free & Non-Profit', zh: 'War of Genesis Idle Loot Helper — 100% 免費、非營利' },
  a_note_from_developer: { vi: 'Lời Nhắn Từ Tác Giả:', en: 'A Note From Developer:', zh: '作者的話：' },
  mb_bank_vietnam_vietqr: { vi: 'Ngân Hàng MB (Việt Nam)', en: 'MB Bank (Vietnam / VietQR)', zh: 'MB 銀行（越南 / VietQR）' },
  binance_pay_global_crypto: { vi: 'Binance Pay (Quốc Tế / Crypto)', en: 'Binance Pay (Global / Crypto)', zh: 'Binance Pay（國際 / 加密貨幣）' },
  scan_with_any_banking_app_vietqr: { vi: 'Quét bằng ứng dụng Ngân hàng bất kỳ', en: 'Scan with any Banking App (VietQR)', zh: '用任何銀行 App 掃描（VietQR）' },
  scan_with_binance_app_binance_pay: { vi: 'Quét bằng App Binance (Binance Pay)', en: 'Scan with Binance App (Binance Pay)', zh: '用 Binance App 掃描（Binance Pay）' },
  bank: { vi: 'NGÂN HÀNG (BANK)', en: 'BANK', zh: '銀行（BANK）' },
  account_number: { vi: 'SỐ TÀI KHOẢN (ACCOUNT NUMBER)', en: 'ACCOUNT NUMBER', zh: '帳號（ACCOUNT NUMBER）' },
  account_holder: { vi: 'CHỦ TÀI KHOẢN (ACCOUNT HOLDER)', en: 'ACCOUNT HOLDER', zh: '戶名（ACCOUNT HOLDER）' },
  note: { vi: 'LỜI NHẮN (NOTE)', en: 'NOTE', zh: '備註（NOTE）' },
  platform: { vi: 'NỀN TẢNG (PLATFORM)', en: 'PLATFORM', zh: '平台（PLATFORM）' },
  binance_pay_id_username: { vi: 'BINANCE PAY ID / USERNAME', en: 'BINANCE PAY ID / USERNAME', zh: 'BINANCE PAY ID / 使用者名稱' },
  supported_coins: { vi: 'TIỀN TỆ HỖ TRỢ (SUPPORTED COINS)', en: 'SUPPORTED COINS', zh: '支援幣別（SUPPORTED COINS）' },
  usdt_busd_bnb_btc_eth_0_fee_via_binance_: { vi: 'USDT, BUSD, BNB, BTC, ETH... (0% phí nội bộ Binance)', en: 'USDT, BUSD, BNB, BTC, ETH... (0% fee via Binance Pay)', zh: 'USDT、BUSD、BNB、BTC、ETH...（Binance 內部 0% 手續費）' },
  quick_guide: { vi: 'HƯỚNG DẪN NHANH (HOW TO PAY)', en: 'QUICK GUIDE', zh: '快速教學（HOW TO PAY）' },
  open_binance_app_tap_b_pay_b_or_b_scan_q: { vi: 'Mở App Binance ➔ Bấm biểu tượng <b>Pay</b> hoặc <b>Quét mã QR</b> góc trên màn hình ➔ Quét mã hoặc nhập Pay ID: <b>User-9e11c</b>.', en: 'Open Binance App ➔ Tap <b>Pay</b> or <b>Scan QR</b> icon at top ➔ Scan QR or enter Pay ID: <b>User-9e11c</b>.', zh: '打開 Binance App ➔ 點選畫面上方的 <b>Pay</b> 或 <b>掃描 QR Code</b> 圖示 ➔ 掃描 QR Code 或輸入 Pay ID：<b>User-9e11c</b>。' },
  support_genesis_helper: { vi: 'Ủng hộ Genesis Helper', en: 'Support Genesis Helper', zh: '贊助 Genesis Helper' },
  wishing_you_great_fun_and_legendary_drop: { vi: '🌟 Chúc bạn chơi game vui vẻ & săn được nhiều đồ giá trị!', en: '🌟 Wishing you great fun and legendary drops!', zh: '🌟 祝你遊戲愉快，掉落滿滿好裝備！' },
  skill_tree_auto_save_pts: { vi: '🌳 Cây Kỹ Năng (Tự Lưu & Điểm Cấp)', en: '🌳 Skill Tree (Auto Save & Pts)', zh: '🌳 技能樹（自動儲存與加點）' },
  farm_ranking_gold_s_exp_s: { vi: '🏆 BXH Cày Vàng & EXP (Money/s & EXP/s)', en: '🏆 Farm Ranking (Gold/s & EXP/s)', zh: '🏆 練功效率排行榜（金幣/秒 & 經驗/秒）' },
  skill_dps_combat_breakdown: { vi: '⚔️ Thống Kê DPS Kỹ Năng (Combat Breakdown)', en: '⚔️ Skill DPS (Combat Breakdown)', zh: '⚔️ 技能 DPS 統計（戰鬥分析）' },
  stage_run_history: { vi: '📜 Lịch Sử Chạy Ải', en: '📜 Stage Run History', zh: '📜 關卡紀錄' },
  profile_exp_progress: { vi: '👤 Hồ Sơ & Tiến Độ EXP', en: '👤 Profile & EXP Progress', zh: '👤 角色資料與經驗進度' },
  jewel_forge_storage: { vi: '💎 Lò Rèn & Kho Ngọc (Auto Fuse)', en: '💎 Jewel Forge & Storage', zh: '💎 鍛造爐與寶石倉庫（自動合成）' },
  ti_ng_vi_t: { vi: 'Tiếng Việt', en: 'Tiếng Việt', zh: '越南文' },
  english: { vi: 'Tiếng Anh', en: 'English', zh: '英文' },
  steam_high_low: { vi: '💵 Giá Steam (cao → thấp)', en: '💵 Steam: High → Low', zh: '💵 Steam 價格（高 → 低）' },
  steam_low_high: { vi: '💵 Giá Steam (thấp → cao)', en: '💵 Steam: Low → High', zh: '💵 Steam 價格（低 → 高）' },
  steam_price: { vi: '💵 Giá Steam ($)', en: '💵 Steam Price ($)', zh: '💵 Steam 價格（$）' },
  steam_price_2: { vi: '💵 Giá Steam (VND)', en: '💵 Steam Price ($)', zh: '💵 Steam 價格（VND）' },
  jewel_lookup_jewels_steam_price: { vi: 'Tra Cứu Ngọc (Jewels & Giá Steam)', en: 'Jewel Lookup (Jewels & Steam Price)', zh: '寶石查詢（寶石與 Steam 價格）' },
  browse_85_jewels_with_stat_ranges_live_s: { vi: 'Tra cứu 85 loại ngọc, chỉ số ngẫu nhiên & giá Steam Market', en: 'Browse 85 jewels with stat ranges & live Steam Market prices', zh: '查詢 85 種寶石、隨機屬性範圍與 Steam Market 價格' },
  jewel_lookup_steam_community_market_pric: { vi: 'Tra Cứu Ngọc & Giá Steam Community Market', en: 'Jewel Lookup & Steam Community Market Prices', zh: '寶石查詢與 Steam 社群市集價格' },
  all_jewel_types: { vi: '📌 Tất cả Loại Ngọc', en: '📌 All Jewel Types', zh: '📌 全部寶石類型' },
  weapon_jewel: { vi: '⚔️ Ngọc Vũ Khí', en: '⚔️ Weapon Jewel', zh: '⚔️ 武器寶石' },
  armor_jewel: { vi: '🛡️ Ngọc Giáp', en: '🛡️ Armor Jewel', zh: '🛡️ 護甲寶石' },
  accessory_jewel: { vi: '💍 Ngọc Phụ Kiện', en: '💍 Accessory Jewel', zh: '💍 飾品寶石' },
  mana_support_jewel: { vi: '🔮 Ngọc Mana / Bổ Trợ', en: '🔮 Mana / Support Jewel', zh: '🔮 魔力／輔助寶石' },
  all_grades: { vi: '🏅 Tất cả Phẩm Cấp', en: '🏅 All Grades', zh: '🏅 全部品級' },
  s_1_low_grade: { vi: '1★ Cấp Thấp', en: '1★ Low-Grade', zh: '1★ 低級' },
  s_2_medium_grade: { vi: '2★ Cấp Trung', en: '2★ Medium-Grade', zh: '2★ 中級' },
  s_3_high_grade_steam: { vi: '3★ Cấp Cao (Steam)', en: '3★ High-Grade (Steam)', zh: '3★ 高級（Steam）' },
  s_4_advanced_steam: { vi: '4★ Cao Cấp (Steam)', en: '4★ Advanced (Steam)', zh: '4★ 進階（Steam）' },
  s_5_special_steam: { vi: '5★ Đặc Biệt (Steam)', en: '5★ Special (Steam)', zh: '5★ 特殊（Steam）' },
  s_6_superior_steam: { vi: '6★ Thượng Hạng (Steam)', en: '6★ Superior (Steam)', zh: '6★ 頂級（Steam）' },
  all_85_jewels: { vi: '🌐 Tất cả (85 loại ngọc)', en: '🌐 All (85 jewels)', zh: '🌐 全部（85 種寶石）' },
  steam_market_only: { vi: '💵 Chỉ ngọc có giá Steam', en: '💵 Steam Market Only', zh: '💵 只顯示有 Steam 價格' },
  grade_6_1: { vi: '⭐ Phẩm cấp (6★ → 1★)', en: '⭐ Grade (6★ → 1★)', zh: '⭐ 品級（6★ → 1★）' },
  grade_1_6: { vi: '⭐ Phẩm cấp (1★ → 6★)', en: '⭐ Grade (1★ → 6★)', zh: '⭐ 品級（1★ → 6★）' },
  jewel_name: { vi: 'Tên Ngọc', en: 'Jewel Name', zh: '寶石名稱' },
  category: { vi: 'Phân Loại', en: 'Category', zh: '分類' },
  grade: { vi: 'Phẩm Cấp', en: 'Grade', zh: '品級' },
  socketed_stat_range_min_max: { vi: 'Chỉ Số Kích Hoạt (Min ~ Max)', en: 'Socketed Stat Range (Min ~ Max)', zh: '鑲嵌屬性範圍（Min ~ Max）' },
  equip_slot_description: { vi: 'Vị Trí Khảm / Mô Tả', en: 'Equip Slot / Description', zh: '鑲嵌位置／說明' },
  auto_confirm_reconnect_on_network_error: { vi: '🌐 Tự động xác nhận kết nối lại khi lỗi mạng', en: '🌐 Auto Confirm Reconnect on Network Error', zh: '🌐 網路異常時自動確認重新連線' },
  when_disconnected_and_reconnect_failed_d: { vi: 'Khi game bị ngắt kết nối và hiện hộp thoại "Kết nối lại thất bại", tự động ấn "Xác nhận" để kết nối lại máy chủ mà không bị gián đoạn treo máy.', en: 'When disconnected and "Reconnect Failed" dialog appears, automatically clicks "Confirm" to resume connection without interrupting AFK.', zh: '當遊戲斷線並跳出「重新連線失敗」對話框時，自動點擊「確認」重新連上伺服器，掛機不中斷。' },
  enabled_auto_confirm_reconnect_on_networ: { vi: '🌐 Đã BẬT tự động xác nhận kết nối lại khi lỗi mạng.', en: '🌐 ENABLED auto-confirm reconnect on network error.', zh: '🌐 已開啟網路異常自動確認重連。' },
  disabled_auto_confirm_reconnect_on_netwo: { vi: '🌐 Đã TẮT tự động xác nhận kết nối lại khi lỗi mạng.', en: '🌐 DISABLED auto-confirm reconnect on network error.', zh: '🌐 已關閉網路異常自動確認重連。' },
  lost_connection_to_genesis_exe: { vi: 'Mất kết nối tới Genesis.exe!', en: 'Lost connection to Genesis.exe!', zh: '與 Genesis.exe 失去連線！' },
  auto_retrying_or_triggering_steam_relaun: { vi: 'Đang tự động thử kết nối lại hoặc kích hoạt Steam mở lại game...', en: 'Auto retrying or triggering Steam relaunch...', zh: '正在自動嘗試重新連線或透過 Steam 重啟遊戲...' },
  launch_game_steam: { vi: '🚀 Bật Game Ngay (Steam)', en: '🚀 Launch Game (Steam)', zh: '🚀 立即啟動遊戲（Steam）' },
  afk_24_7_watchdog: { vi: '🛠️ Treo Đêm 24/7 (Watchdog)', en: '🛠️ AFK 24/7 (Watchdog)', zh: '🛠️ 24/7 整夜掛機（看門狗）' },
  afk_24_7_auto_relaunch_watchdog: { vi: 'Treo Đêm 24/7 Không Lo Mất Kết Nối (Watchdog)', en: 'AFK 24/7 Auto Relaunch (Watchdog)', zh: '24/7 整夜掛機不怕斷線（看門狗）' },
  auto_monitors_relaunches_genesis_exe_on_: { vi: 'Tự động giám sát & bật lại Genesis.exe khi bị crash hoặc mất mạng', en: 'Auto monitors & relaunches Genesis.exe on crash or disconnect', zh: '自動監控並在當機或斷線時重啟 Genesis.exe' },
  launch_game_via_steam: { vi: '🚀 Khởi Động Game Qua Steam', en: '🚀 Launch Game via Steam', zh: '🚀 透過 Steam 啟動遊戲' },
  novice_no_save_loaded: { vi: 'Tân Thủ (Chưa nạp save)', en: 'Novice (No save loaded)', zh: '新手（尚未讀取存檔）' },
  progress_stage: { vi: 'Tiến độ: Ải', en: 'Progress: Stage', zh: '進度：關卡' },
  farming: { vi: 'Đang farm:', en: 'Farming:', zh: '目前練功：' },
  cp: { vi: 'Lực chiến:', en: 'CP:', zh: '戰鬥力：' },
  available_skill_points: { vi: 'Điểm Kỹ Năng Sẵn Có', en: 'Available Skill Points', zh: '可用技能點數' },
  available_skill_points_2: { vi: 'Điểm kỹ năng có sẵn:', en: 'Available skill points:', zh: '可用技能點數：' },
  gold_reserve: { vi: 'Vàng Dự Trữ', en: 'Gold Reserve', zh: '黃金儲備' },
  diamonds: { vi: 'Kim Cương (Dia)', en: 'Diamonds', zh: '鑽石' },
  slot: { vi: 'Vị Trí (Slot)', en: 'Slot', zh: '位置（Slot）' },
  vault_capacity: { vi: 'Dung Lượng Kho Đồ', en: 'Vault Capacity', zh: '倉庫容量' },
  stats_preview: { vi: 'XEM TRƯỚC CHỈ SỐ:', en: 'STATS PREVIEW:', zh: '數值預覽：' },
  active: { vi: 'Đang hoạt động', en: 'Active', zh: '運作中' },
  connecting_genesis_exe: { vi: 'Đang kết nối Genesis.exe', en: 'Connecting Genesis.exe', zh: '正在連線 Genesis.exe' },
  in_development: { vi: 'Đang phát triển', en: 'In Development', zh: '開發中' },
  feature_in_development: { vi: 'Tính năng đang được phát triển', en: 'Feature in development', zh: '功能開發中' },
  live_scan_every_2s: { vi: 'Quét live mỗi 2 giây', en: 'Live scan every 2s', zh: '每 2 秒即時更新' },
  live_sync_2s_tick: { vi: 'Đồng Bộ Trực Tiếp (2s/lần)', en: 'Live Sync (2s/tick)', zh: '即時同步（2 秒／次）' },
  live_sync: { vi: '🔄 Đồng Bộ Trực Tiếp (Live)', en: '🔄 Live Sync', zh: '🔄 即時同步' },
  live_sync_2: { vi: '🔄 Đồng Bộ Trực Tiếp', en: '🔄 Live Sync', zh: '🔄 即時同步' },
  locate_import_save: { vi: '🔍 Định Vị & Nhập Save Game', en: '🔍 Locate & Import Save', zh: '🔍 定位並匯入存檔' },
  export_json: { vi: '💾 Xuất File JSON', en: '💾 Export JSON', zh: '💾 匯出 JSON 檔' },
  restore_game_default: { vi: '↩️ Khôi phục gốc từ Game', en: '↩️ Restore Game Default', zh: '↩️ 從遊戲還原原始資料' },
  default: { vi: '↩️ Hồ sơ gốc', en: '↩️ Default', zh: '↩️ 原始資料' },
  restore_default_profile: { vi: 'Khôi phục hồ sơ mặc định', en: 'Restore default profile', zh: '還原預設角色資料' },
  current_level_progress: { vi: 'Tiến độ cấp độ hiện tại', en: 'Current level progress', zh: '目前等級進度' },
  current_exp: { vi: '📈 EXP Hiện Tại:', en: '📈 Current EXP:', zh: '📈 目前經驗值：' },
  total_exp_clear: { vi: '⭐ Tổng EXP mỗi lần Clear', en: '⭐ Total EXP / Clear', zh: '⭐ 每次通關經驗值' },
  total_exp_gained: { vi: '📦 Tổng EXP Tích Lũy:', en: '📦 Total EXP Gained:', zh: '📦 累計總經驗值：' },
  est_time_to_level_up_calculating: { vi: '⏳ Thời Gian Lên Cấp Dự Kiến: Đang tính toán...', en: '⏳ Est. Time to Level Up: Calculating...', zh: '⏳ 預估升級所需時間：計算中...' },
  level_up_rewards: { vi: '🎁 Phần Thưởng Lên Cấp:', en: '🎁 Level Up Rewards:', zh: '🎁 升級獎勵：' },
  max_gear_tier_tier_5: { vi: 'Tier Trang Bị Tối Đa: Tier 5', en: 'Max Gear Tier: Tier 5', zh: '裝備最高 Tier：Tier 5' },
  equipped_combat_gear: { vi: '⚔️ Trang Bị Chiến Đấu Đang Mặc', en: '⚔️ Equipped Combat Gear', zh: '⚔️ 目前穿戴的戰鬥裝備' },
  accessories_jewelry: { vi: '💍 Trang Sức & Phụ Kiện', en: '💍 Accessories & Jewelry', zh: '💍 飾品與配件' },
  learned_training_skills: { vi: '🏋️ Kỹ Năng Huấn Luyện Đã Học (Training Skills)', en: '🏋️ Learned Training Skills', zh: '🏋️ 已學會的訓練技能' },
  main_weapon: { vi: 'Vũ Khí Chính', en: 'Main Weapon', zh: '主武器' },
  sub_weapon: { vi: 'Vũ Khí Phụ', en: 'Sub Weapon', zh: '副武器' },
  helmet: { vi: 'Mũ Bảo Hiểm', en: 'Helmet', zh: '頭盔' },
  helmet_2: { vi: 'Nón / Mũ', en: 'Helmet', zh: '帽子／頭盔' },
  armor: { vi: 'Áo Giáp', en: 'Armor', zh: '胸甲' },
  gloves: { vi: 'Găng Tay', en: 'Gloves', zh: '手套' },
  shoulders: { vi: 'Giáp Vai', en: 'Shoulders', zh: '肩甲' },
  cloak: { vi: 'Áo Choàng', en: 'Cloak', zh: '披風' },
  boots: { vi: 'Giày', en: 'Boots', zh: '鞋子' },
  boots_2: { vi: 'Giày / Ủng', en: 'Boots', zh: '鞋子／靴子' },
  ring: { vi: 'Nhẫn', en: 'Ring', zh: '戒指' },
  earrings: { vi: 'Khuyên Tai', en: 'Earrings', zh: '耳環' },
  necklace: { vi: 'Dây Chuyền', en: 'Necklace', zh: '項鍊' },
  bracelet: { vi: 'Vòng Tay', en: 'Bracelet', zh: '手鍊' },
  belt: { vi: 'Thắt Lưng', en: 'Belt', zh: '腰帶' },
  belt_2: { vi: 'Dây thắt lưng', en: 'Belt', zh: '腰帶' },
  brooch: { vi: 'Trâm Cài', en: 'Brooch', zh: '胸針' },
  brooch_2: { vi: 'Trâm / Huy hiệu', en: 'Brooch', zh: '胸針／徽章' },
  knight: { vi: '🛡️ Hiệp Sĩ', en: '🛡️ Knight', zh: '🛡️ 騎士' },
  archer: { vi: '🏹 Cung Thủ', en: '🏹 Archer', zh: '🏹 弓箭手' },
  mage: { vi: '🧙 Pháp Sư', en: '🧙 Mage', zh: '🧙 法師' },
  knight_melee: { vi: '🛡️ Hiệp sĩ (Melee)', en: '🛡️ Knight (Melee)', zh: '🛡️ 騎士（近戰）' },
  archer_ranged: { vi: '🏹 Cung thủ (Ranged)', en: '🏹 Archer (Ranged)', zh: '🏹 弓箭手（遠程）' },
  mage_2: { vi: '🧙 Pháp sư (Mage)', en: '🧙 Mage', zh: '🧙 法師' },
  allocated_pts: { vi: 'Điểm Đã Cộng', en: 'Allocated Pts', zh: '已加點數' },
  total: { vi: 'TỔNG SỐ', en: 'TOTAL', zh: '總計' },
  total_2: { vi: 'Tổng Số', en: 'Total', zh: '總計' },
  detailed_skill_effect_description: { vi: 'Mô tả chi tiết hiệu ứng của kỹ năng.', en: 'Detailed skill effect description.', zh: '技能效果詳細說明。' },
  basic_attack: { vi: 'Tấn Công Cơ Bản', en: 'Basic Attack', zh: '基本攻擊' },
  skill_type: { vi: 'Loại kỹ năng:', en: 'Skill Type:', zh: '技能類型：' },
  damage: { vi: 'Sát thương %:', en: 'Damage %:', zh: '傷害 %：' },
  cooldown: { vi: 'Thời gian hồi chiêu:', en: 'Cooldown:', zh: '冷卻時間：' },
  requirement: { vi: 'Yêu cầu mở khóa:', en: 'Requirement:', zh: '解鎖需求：' },
  none_base: { vi: 'Không có (Gốc)', en: 'None (Base)', zh: '無（起始技能）' },
  skill_name: { vi: 'Tên Kỹ Năng', en: 'Skill Name', zh: '技能名稱' },
  afk_farm_ranking_gold_s_exp_s: { vi: '🏆 Bảng Xếp Hạng Hiệu Suất Cày Vàng & EXP AFK (Money/s & EXP/s)', en: '🏆 AFK Farm Ranking (Gold/s & EXP/s)', zh: '🏆 AFK 練功效率排行榜（金幣/秒 & 經驗/秒）' },
  ranked_by_run_history_real_time: { vi: '🏆 Xếp hạng theo Lịch sử chạy (Đo đạc thực tế)', en: '🏆 Ranked by Run History (Real-time)', zh: '🏆 依實測紀錄排序（真實數據）' },
  best_for_gold_farming: { vi: '🌟 TỐI ƯU CÀY VÀNG NHẤT (CHO BẠN)', en: '🌟 BEST FOR GOLD FARMING', zh: '🌟 最佳刷金關卡（推薦給你）' },
  best_for_exp_farming: { vi: '📈 TỐI ƯU CÀY EXP NHẤT (LÊN CẤP NHANH)', en: '📈 BEST FOR EXP FARMING', zh: '📈 最佳刷經驗關卡（快速升級）' },
  your_current_stage: { vi: '📍 ẢI HIỆN TẠI CỦA BẠN', en: '📍 YOUR CURRENT STAGE', zh: '📍 你目前所在的關卡' },
  gold_sec_money_s_highest: { vi: '💰 Vàng / Giây (Money/s) [Cao nhất]', en: '💰 Gold / Sec (Money/s) [Highest]', zh: '💰 金幣／秒（Money/s）〔最高〕' },
  exp_sec_exp_s_highest: { vi: '📈 EXP / Giây (EXP/s) [Cao nhất]', en: '📈 EXP / Sec (EXP/s) [Highest]', zh: '📈 經驗／秒（EXP/s）〔最高〕' },
  gold_min_highest: { vi: '🪙 Vàng / Phút [Cao nhất]', en: '🪙 Gold / Min [Highest]', zh: '🪙 金幣／分〔最高〕' },
  clear_time_fastest: { vi: '⏱️ Thời gian dọn ải [Nhanh nhất]', en: '⏱️ Clear Time [Fastest]', zh: '⏱️ 通關時間〔最快〕' },
  stage_scope: { vi: '🔍 Phạm Vi Ải:', en: '🔍 Stage Scope:', zh: '🔍 關卡範圍：' },
  all_400_game_stages: { vi: 'Tất cả 400 Ải trong Game', en: 'All 400 Game Stages', zh: '遊戲全部 400 個關卡' },
  ranked_by_history_live_data: { vi: 'Xếp hạng Lịch sử chạy (Đo thực tế)', en: 'Ranked by History (Live data)', zh: '依實測紀錄排序（真實數據）' },
  unlocked_stages_only: { vi: 'Chỉ hiện Ải đã mở khóa', en: 'Unlocked Stages Only', zh: '只顯示已解鎖的關卡' },
  all_400_stages_in_game: { vi: 'Toàn bộ 400 ải trong Game', en: 'All 400 Stages in Game', zh: '遊戲全部 400 個關卡' },
  sort_by: { vi: '📊 Sắp Xếp Theo:', en: '📊 Sort By:', zh: '📊 排序方式：' },
  gold_sec_best_afk: { vi: '💰 Vàng / Giây (Tối ưu AFK)', en: '💰 Gold / Sec (Best AFK)', zh: '💰 金幣／秒（最適合掛機）' },
  exp_sec_fast_level: { vi: '📈 EXP / Giây (Tăng cấp nhanh)', en: '📈 EXP / Sec (Fast Level)', zh: '📈 經驗／秒（升級最快）' },
  gold_min_harvest: { vi: '🪙 Vàng / Phút (Thu hoạch)', en: '🪙 Gold / Min (Harvest)', zh: '🪙 金幣／分（收益）' },
  clear_time_fastest_2: { vi: '⏱️ Thời Gian Dọn Ải (Nhanh nhất)', en: '⏱️ Clear Time (Fastest)', zh: '⏱️ 通關時間（最快）' },
  gold_reward_most: { vi: '🎁 Thưởng Vàng (Nhiều nhất)', en: '🎁 Gold Reward (Most)', zh: '🎁 金幣獎勵（最多）' },
  exp_reward_most: { vi: '⭐ Thưởng EXP (Nhiều nhất)', en: '⭐ EXP Reward (Most)', zh: '⭐ 經驗獎勵（最多）' },
  search_stage: { vi: '🔎 Tìm Kiếm Ải:', en: '🔎 Search Stage:', zh: '🔎 搜尋關卡：' },
  reset: { vi: '🔄 Bỏ lọc', en: '🔄 Reset', zh: '🔄 清除篩選' },
  refresh: { vi: '🔄 Làm Mới', en: '🔄 Refresh', zh: '🔄 重新整理' },
  refresh_stats: { vi: '🔄 Làm Mới Phân Tích', en: '🔄 Refresh Stats', zh: '🔄 重新整理分析' },
  optimal_5_gold_faster: { vi: 'Tối ưu: Nhanh hơn +5% Vàng', en: 'Optimal: +5% Gold faster', zh: '最佳選擇：金幣效率快 +5%' },
  compared_to_farming_highest_stage: { vi: 'so với treo máy ở ải cao nhất 2-8 Rất khó!', en: 'compared to farming highest stage!', zh: '相較於在最高難度 2-8 非常困難關卡掛機！' },
  s_17_038_gold_min: { vi: '~17,038 Vàng / Phút', en: '~17,038 Gold / Min', zh: '~17,038 金幣／分' },
  s_1_225_800_exp_hour: { vi: '~1,225,800 EXP / Giờ', en: '~1,225,800 EXP / Hour', zh: '~1,225,800 經驗／小時' },
  accurately_mapped_by_chapter_difficulty_: { vi: 'Đã định danh chuẩn xác theo Chapter & Độ Khó trong game (ví dụ', en: 'Accurately mapped by Chapter & Difficulty in game (e.g.', zh: '依遊戲內章節與難度精準對應 (例如' },
  stage_2_2_very_hard_vine_forest: { vi: 'Ải 2-2 Rất khó (Rừng dây leo)', en: 'Stage 2-2 Very Hard (Vine Forest)', zh: '2-2 非常困難（藤蔓森林）' },
  stage_2_8_very_hard_deep_forest: { vi: 'Ải 2-8 Rất khó (Rừng sâu)', en: 'Stage 2-8 Very Hard (Deep Forest)', zh: '2-8 非常困難（深林）' },
  rank: { vi: '# Hạng', en: '# Rank', zh: '# 名次' },
  run: { vi: '# Lượt', en: '# Run', zh: '# 次數' },
  rank_2: { vi: '🏆 Hạng', en: '🏆 Rank', zh: '🏆 名次' },
  stage: { vi: '🗺️ Ải Trong Game', en: '🗺️ Stage', zh: '🗺️ 遊戲內關卡' },
  region: { vi: '🌲 Khu Vực', en: '🌲 Region', zh: '🌲 區域' },
  gold_sec: { vi: '💰 Vàng / Giây', en: '💰 Gold / Sec', zh: '💰 金幣／秒' },
  exp_sec: { vi: '📈 EXP / Giây', en: '📈 EXP / Sec', zh: '📈 經驗／秒' },
  gold_min: { vi: '🪙 Vàng / Phút', en: '🪙 Gold / Min', zh: '🪙 金幣／分' },
  gold_stage_boss: { vi: '🎁 Thưởng Vàng (Ải + Boss)', en: '🎁 Gold (Stage + Boss)', zh: '🎁 金幣獎勵（關卡＋王）' },
  exp_reward: { vi: '⭐ Thưởng EXP', en: '⭐ EXP Reward', zh: '⭐ 經驗獎勵' },
  clear_time: { vi: '⏱️ Thời Gian Dọn', en: '⏱️ Clear Time', zh: '⏱️ 通關時間' },
  monster_hp: { vi: '❤️ Máu Quái (HP)', en: '❤️ Monster HP', zh: '❤️ 怪物血量（HP）' },
  status: { vi: '📊 Trạng Thái', en: '📊 Status', zh: '📊 狀態' },
  recommendation: { vi: '🎯 Khuyên Dùng', en: '🎯 Recommendation', zh: '🎯 推薦' },
  recommended: { vi: 'Khuyên Dùng', en: 'Recommended', zh: '推薦' },
  recommended_afk: { vi: 'Khuyên Dùng AFK', en: 'Recommended AFK', zh: '推薦掛機' },
  best_stage_afk: { vi: '⭐ TỐI ƯU NHẤT (NÊN AFK)', en: '⭐ BEST STAGE (AFK)', zh: '⭐ 最佳關卡（建議掛機）' },
  current_stage: { vi: 'Ải Hiện Tại', en: 'Current Stage', zh: '目前關卡' },
  normal: { vi: 'Bình thường', en: 'Normal', zh: '普通' },
  stage_run_history_last_20_runs: { vi: '📜 Lịch Sử Chạy Ải (20 Ải Gần Nhất)', en: '📜 Stage Run History (Last 20 Runs)', zh: '📜 關卡紀錄（最近 20 次）' },
  auto_records_last_20_stage_runs_from_gam: { vi: 'Tự động ghi lại 20 lần chạy ải gần nhất từ game. Giữ nguyên định dạng cột của BXH, phân loại màu sắc:', en: 'Auto records last 20 stage runs from game. Preserves table layout, colored status:', zh: '自動記錄遊戲內最近 20 次關卡紀錄，欄位格式與排行榜相同，並依狀態上色：' },
  farming_2: { vi: 'ĐANG ĐÁNH', en: 'FARMING', zh: '戰鬥中' },
  running: { vi: '⚔️ Đang chạy', en: '⚔️ Running', zh: '⚔️ 進行中' },
  cleared: { vi: 'Thành công', en: 'Cleared', zh: '通關成功' },
  cleared_2: { vi: '✅ Thành công', en: '✅ Cleared', zh: '✅ 通關成功' },
  failed: { vi: '❌ FAILED', en: '❌ FAILED', zh: '❌ 失敗' },
  abandoned: { vi: 'Bỏ dở giữa chừng', en: 'Abandoned', zh: '中途放棄' },
  abandoned_2: { vi: '⏹️ Bỏ dở giữa chừng', en: '⏹️ Abandoned', zh: '⏹️ 中途放棄' },
  highest_damage_to_lowest: { vi: 'sát thương cao nhất đến thấp nhất', en: 'highest damage to lowest', zh: '傷害由高至低' },
  and: { vi: 'và', en: 'and', zh: '與' },
  clear_history: { vi: '🗑️ Xóa Lịch Sử', en: '🗑️ Clear History', zh: '🗑️ 清除紀錄' },
  skill_dps_damage_breakdown: { vi: '⚔️ Thống Kê DPS & Sát Thương Chi Tiết Từng Kỹ Năng Hero', en: '⚔️ Skill DPS & Damage Breakdown', zh: '⚔️ 各技能 DPS 與傷害詳細統計' },
  real_time_analysis_optimization_tips_fro: { vi: 'Tự động phân tích và gợi ý tối ưu hóa dựa trên dữ liệu real-time từ game — cập nhật mỗi lần đồng bộ', en: 'Real-time analysis & optimization tips from live game data — updated every sync', zh: '根據遊戲即時數據自動分析並提供優化建議 — 每次同步都會更新' },
  total_real_dps: { vi: 'TỔNG DPS THỰC TẾ', en: 'TOTAL REAL DPS', zh: '實際總 DPS' },
  total_damage_min: { vi: 'TỔNG DAME TRONG 1 PHÚT', en: 'TOTAL DAMAGE / MIN', zh: '每分鐘總傷害' },
  real_dps: { vi: '⚡ DPS Thực Tế:', en: '⚡ Real DPS:', zh: '⚡ 實際 DPS：' },
  combat_dps: { vi: '⚡ DPS Chiến Đấu:', en: '⚡ Combat DPS:', zh: '⚡ 戰鬥 DPS：' },
  total_dmg_min: { vi: '💰 Tổng Dame / Phút', en: '💰 Total Dmg / Min', zh: '💰 每分鐘總傷害' },
  mode_mob_clear_aoe: { vi: '🌾 Chế độ: Quét Lính (AoE)', en: '🌾 Mode: Mob Clear (AoE)', zh: '🌾 模式：清怪（範圍傷害）' },
  mode_boss_fight_single: { vi: '🎯 Chế độ: Đánh Boss (Single)', en: '🎯 Mode: Boss Fight (Single)', zh: '🎯 模式：打王（單體傷害）' },
  skill_attack_game_icon: { vi: '⚔️ Kỹ Năng / Đòn Đánh (Ảnh Game)', en: '⚔️ Skill / Attack (Game Icon)', zh: '⚔️ 技能／攻擊（遊戲圖示）' },
  damage_cast: { vi: '⚡ Sát Thương / Lần Ra Chiêu', en: '⚡ Damage / Cast', zh: '⚡ 每次出招傷害' },
  cooldown_cd: { vi: '⏱️ Hồi Chiêu (CD)', en: '⏱️ Cooldown (CD)', zh: '⏱️ 冷卻時間（CD）' },
  casts_min: { vi: '🔄 Tần Suất / Phút', en: '🔄 Casts / Min', zh: '🔄 每分鐘次數' },
  dps_output: { vi: '💥 DPS Đóng Góp', en: '💥 DPS Output', zh: '💥 DPS 貢獻' },
  contribution: { vi: '📊 Tỷ Lệ % Đóng Góp', en: '📊 Contribution %', zh: '📊 貢獻佔比 %' },
  normal_attack: { vi: '💥 Đòn đánh thường', en: '💥 Normal Attack', zh: '💥 普通攻擊' },
  skill: { vi: '💥 Kỹ năng', en: '💥 Skill', zh: '💥 技能' },
  dps: { vi: 'DPS', en: 'DPS', zh: 'DPS' },
  total_damage: { vi: 'Tổng Dame', en: 'Total Damage', zh: '總傷害' },
  ratio: { vi: 'Tỷ lệ %', en: 'Ratio %', zh: '佔比 %' },
  attack_speed: { vi: 'Tốc Độ Đánh', en: 'Attack Speed', zh: '攻擊速度' },
  damage_amplification: { vi: 'Khuếch Đại Sát Thương', en: 'Damage Amplification', zh: '傷害加成' },
  s_3_class_dps_stats_comparison: { vi: '📊 So Sánh DPS & Chỉ Số Giữa 3 Class (Dữ Liệu Đã Ghi Nhớ)', en: '📊 3-Class DPS & Stats Comparison', zh: '📊 三職業 DPS 與數值比較（已記錄資料）' },
  clear_comparison_history: { vi: '🗑️ Xóa Lịch Sử So Sánh', en: '🗑️ Clear Comparison History', zh: '🗑️ 清除比較紀錄' },
  unrecorded_classes_remain_blank: { vi: '• Class chưa từng được ghi nhận thông tin sẽ để trống (không ghi gì cả).', en: '• Unrecorded classes remain blank.', zh: '• 尚未記錄過的職業會留空（不會顯示任何資料）。' },
  dps_combat_stats_are_auto_saved_whenever: { vi: '• Dữ liệu DPS và chỉ số chiến đấu được tự động lưu lại mỗi khi bạn đăng nhập hoặc chuyển sang chơi class đó trong game.', en: '• DPS & combat stats are auto saved whenever you log in or switch class.', zh: '• 每次登入或在遊戲內切換到該職業時，DPS 與戰鬥數值會自動儲存。' },
  auto_jewel_forge_vault_manager: { vi: '💎 Quản Lý Lò Rèn & Kho Ngọc Tự Động (Auto Jewel Forge & Storage)', en: '💎 Auto Jewel Forge & Vault Manager', zh: '💎 鍛造爐與寶石倉庫自動管理' },
  forge_automatically_collects_gear_jewelr: { vi: 'Lò rèn sẽ tự động gom cả trang bị, trang sức và ngọc trong Balo lẫn Kho đồ (Kho 1, 2, 3).', en: 'Forge automatically collects gear, jewelry, and jewels across Bag and Vault (Tabs 1-3).', zh: '鍛造爐會自動收集背包與倉庫（倉庫 1、2、3）內的裝備、飾品與寶石。' },
  forge_vault_status: { vi: '🤖 Trạng Thái Lò Rèn & Kho', en: '🤖 Forge & Vault Status', zh: '🤖 鍛造爐與倉庫狀態' },
  total_jewels_owned: { vi: '💎 Tổng Số Ngọc Sở Hữu', en: '💎 Total Jewels Owned', zh: '💎 持有寶石總數' },
  tiers_ready_for_fuse: { vi: '⚡ Cấp Ngọc Đủ Điều Kiện Ghép', en: '⚡ Tiers Ready for Fuse', zh: '⚡ 可合成的寶石等級' },
  combine_6_jewels_of_same_tier_into_next_: { vi: 'Đưa 6 viên cùng cấp (không phân biệt loại ngọc) vào Lò rèn để lên cấp cao hơn.', en: 'Combine 6 jewels of same tier into next tier.', zh: '將 6 顆同等級寶石（不分類型）放入鍛造爐即可升級。' },
  automation_settings: { vi: '⚙️ Thiết Lập Tính Năng Tự Động', en: '⚙️ Automation Settings', zh: '⚙️ 自動化功能設定' },
  auto_jewel_fuse: { vi: '⚡ Ghép Ngọc Tự Động', en: '⚡ Auto Jewel Fuse', zh: '⚡ 自動合成寶石' },
  auto_fuse_when_6_jewels_of_same_tier_ava: { vi: 'Tự động ghép ngọc khi đủ 6 viên cùng bậc', en: 'Auto fuse when 6 jewels of same tier available', zh: '湊滿 6 顆同等級寶石時自動合成' },
  allowed_fusion_tiers_jewels: { vi: '🎯 Giới Hạn Bậc Auto Ghép (Chỉ Dành Cho Ngọc):', en: '🎯 Allowed Fusion Tiers (Jewels):', zh: '🎯 自動合成等級限制（僅限寶石）：' },
  all_jewels_tier_1_7: { vi: 'Tất cả ngọc (Tier 1-7)', en: 'All jewels (Tier 1-7)', zh: '全部寶石（Tier 1-7）' },
  auto_store_loose_jewels_into_vault: { vi: 'Tự động cất ngọc lẻ vào Kho đồ', en: 'Auto store loose jewels into Vault', zh: '自動把散落寶石存入倉庫' },
  never_get_full_bag_while_afk: { vi: 'không bao giờ bị đầy Balo khi AFK', en: 'never get full Bag while AFK', zh: '掛機時背包不會爆滿' },
  auto_detect_fuse_jewels_when_ready: { vi: 'Tự động nhận diện & ghép ngọc khi đủ', en: 'Auto detect & fuse jewels when ready', zh: '湊滿數量時自動偵測並合成' },
  auto_detect: { vi: 'Tự động nhận diện', en: 'Auto detect', zh: '自動偵測' },
  fuse_tier_3_gear_req_6_items: { vi: '🛡️ Ghép Trang Bị Tier 3 (Yêu cầu 6 món)', en: '🛡️ Fuse Tier 3 Gear (Req. 6 items)', zh: '🛡️ 合成 Tier 3 裝備（需要 6 件）' },
  auto_fuse_6_tier_3_gear_items_into_tier_: { vi: 'Tự động đưa 6 trang bị cùng Tier 3 trong Balo và Kho đồ (Kho 1, 2, 3) vào lò rèn để nâng lên Tier 4.', en: 'Auto fuse 6 Tier 3 gear items into Tier 4.', zh: '自動把背包與倉庫（倉庫 1、2、3）內 6 件同為 Tier 3 的裝備送入鍛造爐升到 Tier 4。' },
  fuse_tier_3_jewelry_req_3_items: { vi: '💍 Ghép Trang Sức Tier 3 (Yêu cầu 3 món)', en: '💍 Fuse Tier 3 Jewelry (Req. 3 items)', zh: '💍 合成 Tier 3 飾品（需要 3 件）' },
  auto_fuse_3_tier_3_jewelry_items_into_ti: { vi: 'Tự động đưa 3 trang sức cùng Tier 3 trong Balo và Kho đồ (Kho 1, 2, 3) vào lò rèn để nâng lên Tier 4.', en: 'Auto fuse 3 Tier 3 jewelry items into Tier 4.', zh: '自動把背包與倉庫（倉庫 1、2、3）內 3 件同為 Tier 3 的飾品送入鍛造爐升到 Tier 4。' },
  only_fuse_same_level_items: { vi: '🔒 Chỉ ghép các món CÙNG CẤP ĐỘ (Level)', en: '🔒 Only fuse SAME LEVEL items', zh: '🔒 只合成同等級（Level）的物品' },
  fuse_tier_3_now: { vi: '🔨 Ghép Ngay Đồ Tier 3', en: '🔨 Fuse Tier 3 Now', zh: '🔨 立即合成 Tier 3 裝備' },
  auto_equip_best_weapon_on_class_switch: { vi: '⚔️ Tự động lắp Vũ Khí Mạnh Nhất khi đổi Class', en: '⚔️ Auto equip Best Weapon on Class switch', zh: '⚔️ 切換職業時自動裝備最強武器' },
  equip_strongest_main_sub_weapon_for_curr: { vi: 'Lắp ngay vũ khí chính & phụ mạnh nhất phù hợp với Class hiện tại', en: 'Equip strongest main & sub weapon for current class', zh: '立即換上符合目前職業的最強主／副武器' },
  auto_equip_standard_skills_on_class_swit: { vi: '🔮 Tự động đổi Kỹ Năng (Skill) chuẩn khi đổi Class', en: '🔮 Auto equip standard Skills on Class switch', zh: '🔮 切換職業時自動裝備標準技能組' },
  equip_standard_skill_build_for_current_c: { vi: 'Trang bị ngay bộ kỹ năng chuẩn cho Class hiện tại', en: 'Equip standard skill build for current class', zh: '立即裝備該職業的標準技能組' },
  equip_best_weapons: { vi: '⚔️ Tối Ưu Vũ Khí Class', en: '⚔️ Equip Best Weapons', zh: '⚔️ 優化職業武器' },
  equip_standard_skills: { vi: '🔮 Lắp Skill Chuẩn Class', en: '🔮 Equip Standard Skills', zh: '🔮 裝備職業標準技能' },
  store_all_in_vault: { vi: '📦 Cất Toàn Bộ Vào Kho', en: '📦 Store All in Vault', zh: '📦 全部存入倉庫' },
  withdraw_all_to_bag: { vi: '📥 Rút Toàn Bộ Về Balo', en: '📥 Withdraw All to Bag', zh: '📥 全部取回背包' },
  jewel_fuse_progress_6_of_same_tier: { vi: '🔮 Tiến Độ Ghép Ngọc Theo Cấp Độ (Quy tắc 6 viên bất kỳ cùng cấp)', en: '🔮 Jewel Fuse Progress (6 of same tier)', zh: '🔮 依等級顯示的寶石合成進度（任意 6 顆同級即可）' },
  activity_log: { vi: '📜 Nhật Ký Hoạt Động Lò Rèn & Kho', en: '📜 Activity Log', zh: '📜 鍛造爐與倉庫活動紀錄' },
  clear_log: { vi: 'Xóa log', en: 'Clear Log', zh: '清除紀錄' },
  all_tiers: { vi: 'Tất cả cấp bậc', en: 'All Tiers', zh: '全部等級' },
  bag: { vi: 'Balo', en: 'Bag', zh: '背包' },
  vault: { vi: 'Kho', en: 'Vault', zh: '倉庫' },
  inlaid: { vi: 'Khảm', en: 'Inlaid', zh: '鑲嵌中' },
  actions: { vi: 'Thao Tác', en: 'Actions', zh: '操作' },
  loading_jewel_data_from_genesis_exe: { vi: 'Đang nạp danh sách ngọc từ Genesis.exe...', en: 'Loading jewel data from Genesis.exe...', zh: '正在從 Genesis.exe 讀取寶石清單...' },
  forge_rules: { vi: 'ℹ️ Quy tắc Lò rèn:', en: 'ℹ️ Forge Rules:', zh: 'ℹ️ 鍛造規則：' },
  equipment_database: { vi: '🛡️ Bảng Tra Cứu Trang Bị Toàn Game', en: '🛡️ Equipment Database', zh: '🛡️ 全遊戲裝備資料庫' },
  lookup_1_872_items_filter_by_level_slot: { vi: 'Tra cứu 1.872 trang bị & lọc theo cấp / slot', en: 'Lookup 1,872 items & filter by level / slot', zh: '查詢 1,872 件裝備，可依等級／部位篩選' },
  equipment_database_2: { vi: 'Trang Bị Toàn Game', en: 'Equipment Database', zh: '裝備資料庫' },
  training_skills: { vi: 'Kỹ Năng Huấn Luyện (Training Skills)', en: 'Training Skills', zh: '訓練技能' },
  training_skills_gold_upgrade: { vi: 'Kỹ Năng Huấn Luyện (Nâng Vàng)', en: 'Training Skills (Gold Upgrade)', zh: '訓練技能（花金幣升級）' },
  upgrade_base_character_stats: { vi: 'Nâng cấp các chỉ số cơ bản của nhân vật', en: 'Upgrade base character stats', zh: '提升角色基礎數值' },
  all_slots: { vi: 'Tất cả Slot', en: 'All Slots', zh: '全部部位' },
  main_weapon_2: { vi: 'Vũ khí chính', en: 'Main Weapon', zh: '主武器' },
  sub_weapon_2: { vi: 'Vũ khí phụ', en: 'Sub Weapon', zh: '副武器' },
  shoulders_2: { vi: 'Giáp vai', en: 'Shoulders', zh: '肩甲' },
  armor_2: { vi: 'Áo giáp', en: 'Armor', zh: '胸甲' },
  gloves_2: { vi: 'Găng tay', en: 'Gloves', zh: '手套' },
  cloak_2: { vi: 'Áo choàng', en: 'Cloak', zh: '披風' },
  earrings_2: { vi: 'Khuyên tai', en: 'Earrings', zh: '耳環' },
  necklace_2: { vi: 'Dây chuyền', en: 'Necklace', zh: '項鍊' },
  bracelet_2: { vi: 'Vòng tay', en: 'Bracelet', zh: '手鍊' },
  brooch_3: { vi: 'Trâm cài', en: 'Brooch', zh: '胸針' },
  all_tiers_2: { vi: 'Tất cả Tier', en: 'All Tiers', zh: '全部 Tier' },
  tier_1_basic: { vi: 'Tier 1 (Cơ bản)', en: 'Tier 1 (Basic)', zh: 'Tier 1（基礎）' },
  tier_2_common: { vi: 'Tier 2 (Thường)', en: 'Tier 2 (Common)', zh: 'Tier 2（普通）' },
  tier_3_advanced: { vi: 'Tier 3 (Cấp cao)', en: 'Tier 3 (Advanced)', zh: 'Tier 3（高級）' },
  tier_4_superior: { vi: 'Tier 4 (Cao cấp)', en: 'Tier 4 (Superior)', zh: 'Tier 4（進階）' },
  tier_5_rare: { vi: 'Tier 5 (Hiếm)', en: 'Tier 5 (Rare)', zh: 'Tier 5（稀有）' },
  tier_6_divine: { vi: 'Tier 6 (Thần thánh)', en: 'Tier 6 (Divine)', zh: 'Tier 6（神聖）' },
  all_req_levels: { vi: 'Tất cả Cấp YC', en: 'All Req. Levels', zh: '全部需求等級' },
  req_lv_low_high: { vi: '↑ Cấp YC (thấp → cao)', en: '↑ Req. Lv (low → high)', zh: '↑ 需求等級（低 → 高）' },
  req_lv_high_low: { vi: '↓ Cấp YC (cao → thấp)', en: '↓ Req. Lv (high → low)', zh: '↓ 需求等級（高 → 低）' },
  tier_high_low: { vi: '↓ Tier (cao → thấp)', en: '↓ Tier (high → low)', zh: '↓ Tier（高 → 低）' },
  tier_low_high: { vi: '↑ Tier (thấp → cao)', en: '↑ Tier (low → high)', zh: '↑ Tier（低 → 高）' },
  item_name: { vi: 'Tên Trang Bị', en: 'Item Name', zh: '裝備名稱' },
  req_lv: { vi: 'Cấp YC', en: 'Req. Lv', zh: '需求等級' },
  stats: { vi: 'Chỉ Số', en: 'Stats', zh: '數值' },
  price: { vi: 'Giá Bán', en: 'Price', zh: '售價' },
  gold_price: { vi: '↓ Giá Vàng', en: '↓ Gold Price', zh: '↓ 金幣售價' },
  locate_import_game_save_file: { vi: 'Định Vị & Nhập File Dữ Liệu Save Game', en: 'Locate & Import Game Save File', zh: '定位並匯入遊戲存檔資料' },
  auto_read_character_info_level_gear_and_: { vi: 'Tự động đọc thông tin nhân vật, cấp độ, trang bị và ải đang farm', en: 'Auto read character info, level, gear, and farming stage', zh: '自動讀取角色資訊、等級、裝備與目前練功關卡' },
  suggested_save_file_paths_on_your_pc: { vi: '💡 Gợi Ý Đường Dẫn File Save Trên Máy Của Bạn:', en: '💡 Suggested Save File Paths on Your PC:', zh: '💡 你電腦上可能的存檔路徑：' },
  s_1_game_data_folder_windows_appdata: { vi: '📍 1. Thư mục dữ liệu Game (AppData Windows):', en: '📍 1. Game Data Folder (Windows AppData):', zh: '📍 1. 遊戲資料夾（Windows AppData）：' },
  s_2_default_steam_install_folder: { vi: '📍 2. Thư mục cài đặt Steam mặc định:', en: '📍 2. Default Steam Install Folder:', zh: '📍 2. Steam 預設安裝資料夾：' },
  s_3_previously_exported_json_file: { vi: '📍 3. File JSON đã xuất trước đó:', en: '📍 3. Previously Exported JSON File:', zh: '📍 3. 先前匯出的 JSON 檔：' },
  copy: { vi: '📋 Sao chép', en: '📋 Copy', zh: '📋 複製' },
  click_here_to_choose_save_file_or_drag_d: { vi: 'Bấm vào đây để chọn file Save hoặc Kéo thả file vào khung này', en: 'Click here to choose Save file or Drag & Drop file here', zh: '點此選擇存檔，或將檔案拖曳到此區塊' },
  supports_files_formatted_as: { vi: 'Hỗ trợ file định dạng', en: 'Supports files formatted as', zh: '支援檔案格式' },
  character_profile: { vi: 'hồ sơ nhân vật', en: 'character profile', zh: '角色資料' },
  game_running_on_your_pc: { vi: 'Game đang mở trên máy tính?', en: 'Game running on your PC?', zh: '遊戲正在電腦上執行嗎？' },
  auto_reads_data_via_engine_port_127_0_0_: { vi: 'Tự động đọc dữ liệu qua cổng kết nối engine 127.0.0.1:10998', en: 'Auto reads data via engine port 127.0.0.1:10998', zh: '自動透過引擎連線埠 127.0.0.1:10998 讀取資料' },
  search_jewel_name_wild_life_arcane: { vi: 'Tìm tên ngọc (hoang dã, sinh mệnh, bí thuật, kháng phép...)', en: 'Search jewel name (wild, life, arcane...)...', zh: '搜尋寶石名稱（野性、生命、祕術、抗魔...）' },
  type_skill_name_to_locate_on_tree: { vi: 'Gõ tên kỹ năng để tìm vị trí trên Cây...', en: 'Type skill name to locate on tree...', zh: '輸入技能名稱以定位到技能樹上...' },
  search_stage_2_2_2_8_hard_hell: { vi: 'Gõ tên ải (2-2, 2-8, rất khó, địa ngục, rừng)...', en: 'Search stage (2-2, 2-8, hard, hell)...', zh: '輸入關卡名稱（2-2、2-8、非常困難、地獄、森林）...' },
  type_training_skill_name: { vi: 'Gõ tên kỹ năng huấn luyện...', en: 'Type training skill name...', zh: '輸入訓練技能名稱...' },
  search_equipment_by_name: { vi: '🔍 Tìm theo tên trang bị...', en: '🔍 Search equipment by name...', zh: '🔍 依裝備名稱搜尋...' },
  auto_update_on: { vi: '🟢 Tự Động Cập Nhật (BẬT)', en: '🟢 Auto Update (ON)', zh: '🟢 自動更新（開啟）' },
  connecting_genesis_exe_2: { vi: '🔄 Đang kết nối Genesis.exe...', en: '🔄 Connecting Genesis.exe...', zh: '🔄 正在連線 Genesis.exe...' },
  connecting: { vi: '🔄 Đang kết nối...', en: '🔄 Connecting...', zh: '🔄 連線中...' },
  update_paused: { vi: '🟡 Đã tạm dừng cập nhật', en: '🟡 Update Paused', zh: '🟡 已暫停更新' },
  turn_on_auto_update: { vi: '▶️ Bật Tự Động Cập Nhật', en: '▶️ Turn On Auto Update', zh: '▶️ 開啟自動更新' },
  game_not_open_offline: { vi: '⚪ Game chưa mở (Offline)', en: '⚪ Game Not Open (Offline)', zh: '⚪ 遊戲未開啟（離線）' },
  retry_connection: { vi: '▶️ Thử Kết Nối Lại', en: '▶️ Retry Connection', zh: '▶️ 重試連線' },
  support_the_developer_donate_2: { vi: '☕ Ủng Hộ Tác Giả / Support the Developer', en: '☕ Support the Developer / Donate', zh: '☕ 贊助開發者' },
  scan_with_any_banking_app_vietqr_2: { vi: '📲 Quét bằng ứng dụng Ngân hàng bất kỳ', en: '📲 Scan with any banking app (VietQR)', zh: '📲 使用任何銀行 App 掃描' },
  scan_with_binance_app_binance_pay_2: { vi: '📲 Quét bằng App Binance (Binance Pay)', en: '📲 Scan with Binance App (Binance Pay)', zh: '📲 使用 Binance App 掃描（Binance Pay）' },
  support_genesis_helper_your_name: { vi: 'Ủng hộ Genesis Helper [Tên bạn]', en: 'Support Genesis Helper [Your Name]', zh: '贊助 Genesis Helper〔你的名字〕' },
  close: { vi: 'Đóng', en: 'Close', zh: '關閉' },
  copied: { vi: '✅ Đã chép!', en: '✅ Copied!', zh: '✅ 已複製！' },
  passive: { vi: '<span class="node-type-badge badge-passive">🛡️ Bị động</span>', en: '<span class="node-type-badge badge-passive">🛡️ Passive</span>', zh: '<span class="node-type-badge badge-passive">🛡️ 被動</span>' },
  active_2: { vi: '<span class="node-type-badge badge-active">⚔️ Chủ động</span>', en: '<span class="node-type-badge badge-active">⚔️ Active</span>', zh: '<span class="node-type-badge badge-active">⚔️ 主動</span>' },
  passive_skill: { vi: '🛡️ Kỹ Năng Bị Động (Passive)', en: '🛡️ Passive Skill', zh: '🛡️ 被動技能' },
  passive_auto_triggered: { vi: '🛡️ Bị động (Tự động kích hoạt)', en: '🛡️ Passive (Auto triggered)', zh: '🛡️ 被動（自動觸發）' },
  active_skill: { vi: '⚔️ Kỹ Năng Chủ Động (Active)', en: '⚔️ Active Skill', zh: '⚔️ 主動技能' },
  active_cooldown_based: { vi: '⚔️ Chủ động (Có hồi chiêu)', en: '⚔️ Active (Cooldown based)', zh: '⚔️ 主動（有冷卻時間）' },
  by_effect: { vi: 'Theo hiệu ứng', en: 'By effect', zh: '依效果而定' },
  none_starter_skill: { vi: 'Không có (Kỹ năng khởi đầu)', en: 'None (Starter skill)', zh: '無（初始技能）' },
  no_extra_description: { vi: 'Không có mô tả thêm.', en: 'No extra description.', zh: '無其他說明。' },
  normal_2: { vi: '<span style="color:#8b949e;">Bình thường</span>', en: '<span style="color:#8b949e;">Normal</span>', zh: '<span style="color:#8b949e;">普通</span>' },
  best_stage_afk_2: { vi: '<b style="color:#e3b341;">⭐ TỐI ƯU NHẤT (NÊN AFK)</b>', en: '<b style="color:#e3b341;">⭐ BEST STAGE (AFK)</b>', zh: '<b style="color:#e3b341;">⭐ 最佳關卡（建議掛機）</b>' },
  recommended_afk_2: { vi: '<span style="color:#7ee787; font-weight:600;">Khuyên Dùng AFK</span>', en: '<span style="color:#7ee787; font-weight:600;">Recommended AFK</span>', zh: '<span style="color:#7ee787; font-weight:600;">推薦掛機</span>' },
  current_stage_2: { vi: '<span style="color:#58a6ff; font-weight:600;">Ải Hiện Tại</span>', en: '<span style="color:#58a6ff; font-weight:600;">Current Stage</span>', zh: '<span style="color:#58a6ff; font-weight:600;">目前關卡</span>' },
  clears: { vi: 'lần clear', en: 'clears', zh: '次通關' },
  est: { vi: 'ước tính', en: 'est.', zh: '預估' },
  current: { vi: 'Đang ở', en: 'Current', zh: '目前於' },
  stage_2: { vi: 'Ải', en: 'Stage', zh: '關卡' },
  farming_3: { vi: '(đang đánh...)', en: '(farming...)', zh: '（戰鬥中...）' },
  mode_boss_fight_single_2: { vi: '👹 Chế độ: Đánh Boss (Single)', en: '👹 Mode: Boss Fight (Single)', zh: '👹 模式：打王（單體）' },
  gold_s: { vi: ' Vàng/s', en: ' Gold/s', zh: ' 金幣/秒' },
  use_real_dps: { vi: 'Dùng DPS Thực (', en: 'Use Real DPS (', zh: '使用實際 DPS (' },
  s_clear: { vi: 's / lần', en: 's / clear', zh: ' 秒／次' },
  basic: { vi: 'Cơ bản', en: 'Basic', zh: '基本' },
  level: { vi: 'Cấp ', en: 'Level ', zh: '等級 ' },
  no_cd: { vi: 'Không CD', en: 'No CD', zh: '無冷卻' },
  hits_m: { vi: 'đòn/m', en: 'hits/m', zh: '次/分' },
  casts_m: { vi: 'lần/m', en: 'casts/m', zh: '次/分' },
  gear: { vi: 'Trang bị', en: 'Gear', zh: '裝備' },
  click_to_inspect_this_item_in_equipment_: { vi: 'Nhấp để tra cứu chi tiết món đồ này trong bảng Trang bị toàn game', en: 'Click to inspect this item in equipment database', zh: '點擊以在裝備資料庫中查看此物品詳情' },
  upgrade_cost: { vi: '💰 Giá nâng: ', en: '💰 Upgrade Cost: ', zh: '💰 升級花費：' },
  gold: { vi: 'Vàng', en: 'Gold', zh: '金幣' },
  effects: { vi: '✨ Hiệu ứng: ', en: '✨ Effects: ', zh: '✨ 效果：' },
  jewel_lookup_database: { vi: 'Bảng Tra Cứu Ngọc Toàn Game', en: 'Jewel Lookup Database', zh: '全遊戲寶石查詢表' },
  browse_85_jewels_across_weapons_armor_ac: { vi: 'Tra cứu toàn bộ 85 loại ngọc (Vũ khí, Áo giáp, Phụ kiện, Mana) kèm biên độ chỉ số ngẫu nhiên và giá tiền thật trên Steam Market', en: 'Browse 85 jewels across weapons, armor, accessories and mana stones with stat ranges & live Steam Market prices', zh: '查詢全部 85 種寶石（武器、護甲、飾品、魔力）的隨機屬性範圍與 Steam Market 即時價格' },
  fixed_stats_or_enhancement_bonus: { vi: 'Chỉ số khảm cố định hoặc thăng cấp', en: 'Fixed stats or enhancement bonus', zh: '固定鑲嵌屬性或強化加成' },
  listings: { vi: ' tin bán', en: ' listings', zh: ' 筆販售' },
  not_tradable_on_steam_market_in_game_bou: { vi: 'Không bán trên chợ Steam (Khóa theo tài khoản)', en: 'Not tradable on Steam Market (In-game bound)', zh: '無法在 Steam 市集交易（帳號綁定）' },
  first: { vi: 'Đầu', en: 'First', zh: '第一頁' },
  prev: { vi: 'Trước', en: 'Prev', zh: '上一頁' },
  page: { vi: 'Trang ', en: 'Page ', zh: '第 ' },
  next: { vi: 'Sau', en: 'Next', zh: '下一頁' },
  last: { vi: 'Cuối', en: 'Last', zh: '最後頁' },
  jewels: { vi: ' viên', en: ' jewels', zh: ' 顆' },
  tiers: { vi: ' cấp', en: ' tiers', zh: ' 級' },
  ready: { vi: 'Đủ: ', en: 'Ready: ', zh: '已足夠：' },
  req_6_jewels_of_same_tier: { vi: 'Yêu cầu 6 viên cùng cấp', en: 'Req. 6 jewels of same tier', zh: '需要 6 顆同等級' },
  max_tier: { vi: '<span style="color:#8b949e; font-size:11.5px;">⭐ Cấp tối đa</span>', en: '<span style="color:#8b949e; font-size:11.5px;">⭐ Max Tier</span>', zh: '<span style="color:#8b949e; font-size:11.5px;">⭐ 最高等級</span>' },
  inlaid_2: { vi: '<span style="font-size:11.5px; color:#484f58;">Đang khảm</span>', en: '<span style="font-size:11.5px; color:#484f58;">Inlaid</span>', zh: '<span style="font-size:11.5px; color:#484f58;">鑲嵌中</span>' },
  live_status_prefix: { vi: '🟢 Trực tiếp (', en: '🟢 Live (', zh: '🟢 直播中 (' },
  node_lock_req_lv_prefix: { vi: '<div class="node-lock-tag">🔒 Cần Lv.', en: '<div class="node-lock-tag">🔒 Req. Lv.', zh: '<div class="node-lock-tag">🔒 需求 Lv.' },
  req_lv_short_prefix: { vi: 'Yêu cầu: Lv.', en: 'Req: Lv.', zh: '需求：Lv.' },
  name_req_level_suffix: { vi: ' | Yêu cầu: Cấp ', en: ' | Req: Level ', zh: ' | 需求：等級 ' },
  prereq_prefix: { vi: 'Cần ', en: 'Req: ', zh: '需要 ' },
  prereq_lv_infix: { vi: ' (Cấp ', en: ' (Lv. ', zh: ' (等級 ' },
  unlocked_stages_only_prefix: { vi: 'Chỉ hiện Ải đã mở khóa (≤ Ải ', en: 'Unlocked Stages Only (≤ Stage ', zh: '只顯示已解鎖的關卡 (≤ 關卡 ' },
  gold_sec_suffix: { vi: ' Vàng / Giây', en: ' Gold / Sec', zh: ' 金幣／秒' },
  exp_sec_suffix: { vi: ' EXP / Giây', en: ' EXP / Sec', zh: ' 經驗／秒' },
  general_dmg_prefix: { vi: 'Sát thương +: +', en: 'General Dmg: +', zh: '一般傷害 +' },
  pve_dmg_infix: { vi: '% | PvE +: +', en: '% | PvE Dmg: +', zh: '% | PvE 傷害 +' },
  boss_dmg_infix: { vi: '% | Boss +: +', en: '% | Boss Dmg: +', zh: '% | Boss 傷害 +' },
  effective_paren_infix: { vi: '% (Hiệu lực: +', en: '% (Effective: +', zh: '% (實際生效：+' },
  level_prefix: { vi: 'Cấp Độ ', en: 'Level ', zh: '等級 ' },
  max_gear_tier_prefix: { vi: 'Tier Trang Bị Tối Đa: Tier ', en: 'Max Gear Tier: Tier ', zh: '裝備最高 Tier：Tier ' },
  eta_to_level_prefix: { vi: '⏳ Ước tính lên Cấp ', en: '⏳ Est. to Level ', zh: '⏳ 預估升至等級 ' },
  based_on_farm_infix: { vi: '(dựa trên farm ~', en: '(based on farm ~', zh: ' (依約 ' },
  no_combat_gear_loaded: { vi: 'Chưa có dữ liệu trang bị chiến đấu.', en: 'No combat gear loaded.', zh: '尚無戰鬥裝備資料。' },
  click_here_to: { vi: 'Bấm vào đây để', en: 'Click here to', zh: '點擊這裡以' },
  no_accessory_data: { vi: 'Chưa có dữ liệu trang sức.', en: 'No accessory data.', zh: '尚無飾品資料。' },
  no_training_skill_data: { vi: 'Chưa có dữ liệu kỹ năng huấn luyện.', en: 'No training skill data.', zh: '尚無訓練技能資料。' },
  training_skill_hash_prefix: { vi: 'Kỹ Năng #', en: 'Training Skill #', zh: '訓練技能 #' },
  level_paren_prefix: { vi: '(Cấp ', en: '(Level ', zh: ' (等級 ' },
  cost_paren_infix: { vi: ' (Chi phí: ', en: ' (Cost: ', zh: ' (花費：' },
  gold_close_paren: { vi: ' Vàng)', en: ' Gold)', zh: ' 金幣)' },
  showing_prefix: { vi: 'Hiển thị ', en: 'Showing ', zh: '顯示 ' },
  jewels_unit: { vi: 'ngọc', en: 'jewels', zh: '顆寶石' },
  items_unit: { vi: 'trang bị', en: 'items', zh: '件裝備' },
  no_equipment_matched_filters: { vi: 'Không tìm thấy trang bị nào phù hợp với bộ lọc.', en: 'No equipment matched the filters.', zh: '找不到符合篩選條件的裝備。' },
  slots_paren_prefix: { vi: ' ô (', en: ' slots (', zh: ' 格（' },
  tabs_close_paren: { vi: ' Kho)', en: ' Tabs)', zh: ' 個倉庫）' },
  avail_slots_prefix: { vi: 'Trống ', en: 'Free: ', zh: '剩餘 ' },
  avail_slots_suffix: { vi: ' ô nhận đồ', en: ' slots', zh: ' 格可用' },
  tier_num_prefix: { vi: 'Cấp ', en: 'Tier ', zh: 'Tier ' },
  times_close_paren: { vi: ' lượt)', en: 'x)', zh: ' 組)' },
  ready_to_fuse_prefix: { vi: '⚡ Đủ ghép ', en: '⚡ Ready to fuse ', zh: '⚡ 已可合成 ' },
  sets_paren_infix: { vi: ' lần (', en: 'x (', zh: ' 次（' },
  jewels_close_span: { vi: ' viên)</span>', en: ' jewels)</span>', zh: ' 顆）</span>' },
  fuse_tier_prefix: { vi: '⚡ Ghép Cấp ', en: '⚡ Fuse Tier ', zh: '⚡ 合成 Tier ' },
  has_jewels_prefix: { vi: 'Có ', en: 'Has ', zh: '擁有 ' },
  need_paren_infix: { vi: '/6 viên (Thiếu ', en: '/6 jewels (Need ', zh: '/6 顆 (還需 ' },
  need_6_jewels: { vi: 'Chưa đủ 6 viên', en: 'Need 6 jewels', zh: '尚未達到 6 顆' },
  no_jewels_matched_filter: { vi: 'Không tìm thấy viên ngọc nào phù hợp với bộ lọc.', en: 'No jewels matched the filter.', zh: '找不到符合篩選條件的寶石。' },
  store_paren_prefix: { vi: '📦 Cất (', en: '📦 Store (', zh: '📦 存入 (' },
  take_paren_prefix: { vi: '📥 Rút (', en: '📥 Take (', zh: '📥 取出 (' },
  };

  // Runtime lookup tables keyed by the literal source text (built once from
  // I18N_STRINGS above) — this is what applyToDOM/translate actually match against,
  // since Vietnamese source text is what's baked into the HTML at build time.
  const I18N_DICT = (function buildDict() {
    const byLang = {};
    LANGS.forEach(function(l) { if (l !== 'vi') byLang[l] = {}; });
    for (const key in I18N_STRINGS) {
      const entry = I18N_STRINGS[key];
      LANGS.forEach(function(l) {
        if (l !== 'vi' && entry[l]) byLang[l][entry.vi] = entry[l];
      });
    }
    return byLang;
  })();

  function getLang() {
    return localStorage.getItem(LANG_KEY) || 'vi';
  }

  function setLang(lang) {
    localStorage.setItem(LANG_KEY, lang);
  }

  function isEnglish() {
    return getLang() === 'en';
  }

  const NUMBER_LOCALES = { vi: 'vi-VN', en: 'en-US', zh: 'zh-TW' };

  // BCP-47 locale for Number/Date#toLocaleString, matching the current language —
  // for grouping separators (1.234 vs 1,234) and similar locale-aware formatting.
  function numberLocale(lang) {
    return NUMBER_LOCALES[lang !== undefined ? lang : getLang()] || NUMBER_LOCALES.vi;
  }

  // The main lookup call sites should use: looks up I18N_STRINGS[key] and returns
  // the string for the current (or given) language. Falls back to the entry's `vi`
  // text if the target language has no translation, and to the bare key itself if
  // the key doesn't exist (loud enough to spot in the UI, unlike silently returning
  // undefined). This is the API application code should call — it takes a stable
  // identifier, never the Vietnamese source text, so the Vietnamese only lives in
  // this dictionary's `vi` data field, not scattered through render functions.
  function t(key, lang) {
    const entry = I18N_STRINGS[key];
    if (!entry) return key;
    const useLang = lang !== undefined ? lang : getLang();
    return entry[useLang] || entry.vi;
  }

  // Internal: dictionary lookup for a single Vietnamese source string. Used only by
  // applyToDOM, which has no choice but to match against the literal text already
  // sitting in the DOM (that's what the static HTML is written in). Application code
  // should call t(key) instead — never this.
  function translate(text, lang) {
    if (!text) return text;
    const useLang = lang !== undefined ? lang : getLang();
    if (useLang === 'vi') return text;
    const dict = I18N_DICT[useLang];
    if (!dict) return text;
    const trimmed = text.trim();
    return dict[trimmed] || text;
  }

  function translateStageTag(tag) {
    if (!tag) return '';
    if (!isEnglish()) return tag;
    return tag.replace('Rất khó', 'Very Hard')
              .replace('Rất Khó', 'Very Hard')
              .replace('Cực khó', 'Expert')
              .replace('Cực Khó', 'Expert')
              .replace('Ác mộng', 'Nightmare')
              .replace('Ác Mộng', 'Nightmare')
              .replace('Địa ngục', 'Hell')
              .replace('Địa Ngục', 'Hell')
              .replace('Khó', 'Hard')
              .replace('Thường', 'Normal')
              .replace('Dễ', 'Easy')
              .replace('Ải', 'Stage');
  }

  // Walks document.body swapping translatable text nodes, placeholders, and title
  // tooltips between the original Vietnamese and the target language's dictionary
  // entries. Original text is cached on each node (__viText/__viPlaceholder/
  // __viTitle) the first time it's visited, so switching back to Vietnamese is
  // lossless even for text this dictionary has no entry for.
  function applyToDOM(lang) {
    const dict = I18N_DICT[lang] || null;

    // 1. Walk text nodes in document.body
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'code' || parent.classList.contains('notranslate')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      },
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.__viText === undefined) {
        node.__viText = node.nodeValue;
      }
      if (dict) {
        const orig = node.__viText;
        const leadingMatch = orig.match(/^\s*/);
        const trailingMatch = orig.match(/\s*$/);
        const leading = leadingMatch ? leadingMatch[0] : '';
        const trailing = trailingMatch ? trailingMatch[0] : '';
        const trimmed = orig.trim();
        if (trimmed && dict[trimmed]) {
          node.nodeValue = leading + dict[trimmed] + trailing;
        }
      } else {
        if (node.__viText !== undefined) {
          node.nodeValue = node.__viText;
        }
      }
    }

    // 2. Translate Input / Textarea Placeholders
    const inputs = document.querySelectorAll('input[placeholder], textarea[placeholder]');
    inputs.forEach(function(el) {
      if (el.__viPlaceholder === undefined) {
        el.__viPlaceholder = el.placeholder;
      }
      if (dict) {
        const trimmed = el.__viPlaceholder.trim();
        if (trimmed && dict[trimmed]) {
          el.placeholder = dict[trimmed];
        }
      } else {
        if (el.__viPlaceholder !== undefined) {
          el.placeholder = el.__viPlaceholder;
        }
      }
    });

    // 3. Translate Element Tooltips (titles)
    const titled = document.querySelectorAll('[title]');
    titled.forEach(function(el) {
      if (el.__viTitle === undefined) {
        el.__viTitle = el.title;
      }
      if (dict) {
        const trimmed = el.__viTitle.trim();
        if (trimmed && dict[trimmed]) {
          el.title = dict[trimmed];
        }
      } else {
        if (el.__viTitle !== undefined) {
          el.title = el.__viTitle;
        }
      }
    });
  }

  return { getLang, setLang, isEnglish, t, translate, translateStageTag, applyToDOM, numberLocale, LANGS, strings: I18N_STRINGS };
})();
