# 调研与设计说明

目标：孩子站在客厅电视前，用真实踢腿控制屏幕足球。摄像头实时捕捉身体，默认由 **Three.js 三维球员**呈现动作：人物在左、面向右侧球门，足球在人物与球门之间。孩子仍面向电视自然抬脚；也可切换正面的“风格化抠像”或“真人抠像”。

## 1. 姿态方案选型

| 方案 | 关键点 | 浏览器实时 | 人像分割 | 授权 | 部署成本 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **OpenPose** | 25 (BODY_25) | 无官方 Web 构建 | 无 | 非商用免费，商用需授权 | CUDA GPU + Caffe，模型数 GB | 不采用 |
| **MediaPipe Pose Landmarker** | 33 + 世界坐标 | WASM + WebGL | 可配 Selfie Segmenter | Apache-2.0 | 纯前端，模型约 6 MB | **采用** |
| TensorFlow.js MoveNet | 17 | 支持 | 需另配 | Apache-2.0 | 纯前端 | 备选 |
| TensorFlow.js PoseNet | 17 | 支持 | 需另配 | Apache-2.0 | 纯前端 | 精度偏低 |
| YOLOv8-pose | 17 | 需 ONNX Runtime Web | 需另配 | AGPL-3.0 | 需导出和调优 | 备选 |
| MMPose / HRNet | 17–26 | 需 Python 服务 | 需另配 | Apache-2.0 | 服务端 GPU | 不采用 |

项目描述提到“基于 OpenPose”，但 OpenPose 不适合“浏览器打开即玩”的交付形态：商业授权需要另行处理，部署依赖 CUDA/Caffe，没有官方浏览器路径，也不能直接提供抠像。最终保留 OpenPose 的核心思路——人体关键点驱动游戏——换用 MediaPipe Tasks Vision。

MediaPipe 的脚踝、脚跟和脚尖关键点正好覆盖踢球检测；同一 API 可接入 Selfie Segmenter。GPU 委托不可用时可回退 CPU，运行时和模型均可离线分发。

## 2. 为什么使用真正的 3D 渲染

初版使用正面球场和人物抠像，实际画面存在两个空间问题：人物挡在球与球门之间，正面人物也无法自然表现为面向画面深处的球门。仅移动足球或水平翻转抠像不能解决，因为孩子仍需面向电视和摄像头。

第二版改为 Canvas 侧视卡通角色，解决了朝向和顺序，但用户明确不希望继续使用卡通。本版因此采用 Three.js/WebGL2：

- 透视相机、真实深度缓冲、PBR 材质、灯光和阴影，不再是平面角色贴在背景上；
- 球员、足球、球门和守门员都是三维网格，足球飞行在三维空间中呈现；
- 继续复用侧视姿态映射、踢球判定、z/h 物理和计分，避免重写已经验证的游戏手感；
- 本地模块和 import map 分发，运行时不访问 CDN。

当前球员是**真实比例的程序化 3D 人体网格**，由胶囊、圆柱和球体等几何体组成，不是照片级人物或孩子本人的扫描。它的优势是零外部人物资产、骨骼驱动接口简单、三角形数量低；局限是皮肤、布料和面部细节仍明显简化。

调研过带骨骼与蒙皮权重的人体数据，但数据包的许可标记为 AGPL3，且没有现成动画，纳入后会增加授权审查、格式转换和骨骼重定向工作。因此没有把这些数据放入交付包。后续若需要更高写实度，应选用许可明确的 GLB 骨骼模型，只替换 `scene3d.js` 的人物实现。

### 3D 渲染与物理的边界

本版是“**真 3D 渲染 + 既有 2.5D 游戏物理**”：

- 渲染使用 Three.js 世界坐标、透视相机和深度缓冲；
- 游戏逻辑继续用 `z ∈ [0,1]` 表示脚边到球门线、`h` 表示离地高度；
- `drawX / z / h` 在 `scene3d.js` 中映射为世界坐标，相机产生自然透视缩放；
- 重力、弹跳、门柱/横梁、守门员和进球判定不变。

这样能用较低风险获得三维观感，同时保持原有射门难度和测试结果的可比性。

## 3. 实时链路

```text
video / demo canvas / photo
        │ 每个渲染帧
        ▼
PoseTracker.detect()
  ├─ PoseLandmarker（VIDEO）── 33 个归一化关键点
  └─ ImageSegmenter（VIDEO）── 人像 mask
        │ 按耗时自适应节流：姿态 0/80/150ms，分割 80/200ms
        ▼
buildPoseSample()
  ├─ 归一化坐标 → 屏幕坐标（镜像 + object-fit letterbox）
  ├─ ankle/heel/toe 按 visibility 加权为脚部质心
  ├─ 140ms 速度窗口 → vx/vy/speed
  └─ 身体中心、身高与 EMA 平滑
        │
        ├─ 3D / 卡通：sideViewPose() → 左侧角色、向右摆腿
        └─ 正面抠像：保留正面坐标
        ▼
SoccerGame.update(dt)
        ▼
Renderer
  ├─ #stage3d：3D 球场、人物、守门员和足球
  └─ #stage：2D 彩带、提示、文字和调试层
```

摄像头按 `cover` 裁剪，照片按 `contain` 留边；关键点与 mask 使用相同映射。3D 模式不依赖 mask，只消费关键点，因此弱光或复杂背景不会产生抠像残影。切换正面抠像时隐藏 WebGL 画布并恢复正面布局。

## 4. 踢球检测

儿童踢腿幅度和速度差异大，且正面摄像头的画面位移不等于真实速度，因此以身高为尺度归一化：

- 触球半径：`reach = ballR × 1.95 + personHeight × 0.06`；
- 脚部质心速度需达到 `minFootSpeed × personHeight`；
- 脚在触球范围内，或 0.3 秒内曾进入 `reach × 1.3` 的助跑窗口；
- 冷却 0.36–0.45 秒，避免一次抬腿重复射门；
- `power = clamp((speed / minSpeed - 0.85) / 1.9, 0, 1)`；
- 水平脚速影响落点，`aimSpread` 按难度加入偏差。

| 难度 | 最小脚速（×身高/秒） | 最大初速 | 守门员 |
| --- | --- | --- | --- |
| 萌新 | 1.15 | 6.4 m/s | 无 |
| 小将 | 1.70 | 8.2 m/s | 会扑救 |
| 球星 | 2.20 | 9.2 m/s | 更快、范围更大 |

`fireKick()` 统一记录 `lastKickFoot`，真实动作和演示/调试强制射门都能驱动同一条 3D 摆腿动画。

## 5. 三维场景与姿态映射

`src/scene3d.js` 包含：

- `WebGLRenderer`、WebGL2、ACES Filmic 色调映射、sRGB 输出、PCF 软阴影；
- 透视相机、程序草地纹理和条纹、白线、斜向球门框架与立体球网；
- 实例化看台观众、广告牌、灯杆、半球光和方向光；
- 带程序黑白纹理与 bumpMap 的球体足球；
- 主球员和守门员的三维躯干、四肢、头发、五官、球袜与鞋。

`sideViewPose()` 继续把真实正面动作映射到固定侧视舞台：人物锚点在画面 23% 宽度，球门中心在 82%。3D 球员在世界坐标中朝 `+x`，球门位于其右前方；`ballAnchor()` 把待机和重生足球放在人物前方，并受球门范围约束。

球门与禁区线绕 Y 轴旋转约 30°（`GOAL_ANGLE = -0.52`），展示门框侧面和球网深度。守门员位置通过同一局部坐标系变换；射门终点根据目标 x 计算旋转后的球门平面 z，避免画面旋转后足球从门柱旁边穿过。实机在球路末段采样时，足球世界坐标与目标平面的计算误差为 0。

脚踝离地量决定抬腿，射门后的短时间内再根据 `lastKickFoot` 补充摆动。这样即使演示模式没有真实脚部轨迹，也能看到明确射门动作。真实孩子不需要侧站，脚部速度仍来自原始 `PoseSample`，无需增加深度模型。

## 6. 正面抠像模式

两种可选模式保留原正面布局：

- **风格化抠像**：在人物包围盒内做 mask 合成、饱和度/对比度调整、海报化、暖纸色与纸纤维，再用距离变换生成纸边和墨线；
- **真人抠像**：mask 置信度经 smoothstep 转为 alpha，用 `destination-in` 保留真人，并加青色描边。

历史 720p 软件渲染测量中，风格化包围盒处理约 4.95ms/帧，真人抠像约 9.3ms/帧；这些不是本轮 Intel 核显 3D 的性能数据。

## 7. 本机实测

硬件与驱动：Intel Xeon E-2224G、Intel UHD Graphics P630（Coffee Lake GT2）、i915、Mesa 25.2.8。桌面 Chrome 的 WebGL2 renderer 为：

```text
ANGLE (Intel, Mesa Intel(R) UHD Graphics P630 (CFL GT2), OpenGL ES 3.2)
```

这证明实机链路使用 Intel 核显，而不是 SwiftShader。

- 默认设置为 `avatar: "3d"`，WebGL2 场景正常创建；
- 演示完成 1 次射门、1 次进球，待机、抬脚、飞行、进球和重生顺序正确；
- 120 帧采样平均间隔 17.8815ms，p95 22.13ms，约 55.92 FPS；
- 1280×720 演示约 64 draw calls、13,626 triangles、65 geometries、4 textures；
- 960×540 Y4M 假摄像头约 65 draw calls、14,394 triangles，姿态 delegate 为 GPU，mask 可用；
- 真实照片检测到双脚，`personHeight ≈ 473.05`，3D 球员正常抬腿；
- 风格化和真人模式恢复 `sideView: false` 并隐藏 WebGL，切回 3D 后恢复侧视；
- 900×600 窗口保持人物、足球、球门顺序；
- 实机照片和摄像头运行控制台错误均为空。

截图位于 `docs/3d/`。本轮 15/15 游戏逻辑测试、32/32 Playwright 浏览器检查通过，覆盖默认 WebGL2/3D、射门脚部标记、三种形象、真实照片与假摄像头。端到端脚本使用 SwiftShader，是自动化兼容性链路；以上性能数据来自桌面 Chrome 真核显运行，两者不混为同一结果。

## 8. 局限与后续

- **不是孩子本人的三维扫描**：默认是通用程序化 3D 球员；要看真人需切换抠像模式。
- **单目深度歧义**：正面摄像头无法精确知道脚离镜头多远，只能按身高归一化速度。
- **人物动画是近似映射**：脚踝被遮挡或关键点抖动时，姿势会简化；踢球判定与 3D 动画相互独立。
- **物理仍是 2.5D**：三维观感真实，但不是刚体引擎中的任意方向碰撞。
- **单人不支持多人**：多人同框会选择一个人，可能互相干扰。
- **真实足球不参与识别**：踢空也能触发，更适合低龄儿童。
- 后续可做授权明确的 GLB 球员、换装、多人轮流、真实球颜色追踪和电视端封装。

## 9. 参考资料

- OpenPose: <https://github.com/CMU-Perceptual-Computing-Lab/openpose>
- MediaPipe Pose Landmarker: <https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker>
- MediaPipe Image Segmenter: <https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter>
- MediaPipe Tasks Vision (Web): <https://www.npmjs.com/package/@mediapipe/tasks-vision>
- Three.js: <https://threejs.org/>
- BlazePose: Bazarevsky et al., “On-device Real-time Body Pose Tracking”, 2020
- MoveNet: <https://www.tensorflow.org/hub/tutorials/movenet>
