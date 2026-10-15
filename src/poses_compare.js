// 姿势 23-24：比手 / 比脚（照 qwertyaz111 手の大きさ・足の大きさ比較ツール 的玩法）。约定同前：矮个 S、高个 T。
// 参考：两人并排面向镜头，手掌/脚掌摊开朝观众，靠视觉重叠比大小（渲染层画掌板）。
import { V, fk } from './model.js';
import { base, set, footAt, placeLimb, handsHang } from './poseutil.js';

// 比手 / 比脚：只画掌印、脚印叠放（渲染层 makePrints），两个小人隐藏。这里给个站姿占位，保证相机和其它逻辑正常。
const standIn = (dT, dS) => {
  // 分开量随臂长走（垂着的手和胳膊互不沾）；手外张取小值（张大了 IK 够不到，0.05h 是 reach 安全线）
  const T = base(dT, -(dT.bodyW / 2 + 0.14 + dT.arm * 0.3), 0.05);
  const S = base(dS, dS.bodyW / 2 + 0.14 + dS.arm * 0.3, -0.05);
  handsHang(T, dT, 0.05); handsHang(S, dS, 0.05);
  return { T, S };
};
export const compareHand = (dT, dS) => ({ ...standIn(dT, dS), prints: 'hand', skipAuto: ['T', 'S'], hold: [] });
export const compareFoot = (dT, dS) => ({ ...standIn(dT, dS), prints: 'foot', skipAuto: ['T', 'S'], hold: [] });
// 熊掌 / 兔爪印：同样只画印子叠放。前掌印取手长、后掌印取脚长；熊/兔形状跟耳朵走（兔耳=兔爪，其余=熊掌）
export const comparePawF = (dT, dS) => ({ ...standIn(dT, dS), prints: 'pawF', skipAuto: ['T', 'S'], hold: [] });
export const comparePawH = (dT, dS) => ({ ...standIn(dT, dS), prints: 'pawH', skipAuto: ['T', 'S'], hold: [] });
