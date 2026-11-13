/**
 * GLSL ES 3.00 着色器源码。
 *
 * 五个程序构成整条渲染管线：
 * - line  : CAD 线条（屏幕空间宽度展开 + 模型空间虚线 + 边缘抗锯齿）
 * - fill  : 三角化填充（HATCH / SOLID / WIPEOUT / 填充多边形）
 * - glyph : 文字字形图集四边形（TTF / 中文，遮罩纹理着色）
 * - point : 点实体（gl_PointSize 圆点）
 * - grid  : 自适应世界坐标栅格背景（全屏三角形，片元着色器画线）
 *
 * 坐标约定：
 * - 顶点位置为「分块局部模型坐标」（chunk origin 减除，保证浮点精度），
 *   由 u_proj（mat3，模型 → 裁剪空间）统一变换；
 * - 线宽为屏幕像素语义（与 CAD 显示一致，不随缩放放大）；
 * - 虚线节距为模型单位（随缩放缩放，与 CAD 线型定义一致）。
 */

/** 顶点属性通道布局（与 mesh/vertexLayout.ts 的 CPU 侧打包一一对应）。 */
export const LINE_ATTRIBS = {
  a_pos: 0,        // vec2 分块局部坐标
  a_normal: 1,     // vec2 斜接法线（单位，模型空间）
  a_params: 2,     // vec4: signedSide×miterScale, widthPx, arcLen, dashIdx(0=实线)
  a_color: 3,      // vec4 归一化 ubyte RGBA
} as const;

export const FILL_ATTRIBS = {
  a_pos: 0,        // vec2
  a_color: 1,      // vec4
} as const;

export const GLYPH_ATTRIBS = {
  a_pos: 0,        // vec2 四边形角点（分块局部模型坐标）
  a_uv: 1,         // vec2 图集 UV
  a_color: 2,      // vec4
  a_page: 3,       // float 图集页号（sampler2DArray layer）
} as const;

export const POINT_ATTRIBS = {
  a_pos: 0,        // vec2
  a_color: 1,      // vec4
} as const;

const COMMON = /* glsl */`#version 300 es
precision highp float;
`;

// ─────────────────────────────────────────────────────────────────────────────
// line：CAD 线条
// ─────────────────────────────────────────────────────────────────────────────

const LINE_VERTEX = /* glsl */`
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_normal;
layout(location=2) in vec4 a_params;   // x: side*miterScale  y: widthPx  z: arcLen  w: dashIdx
layout(location=3) in vec4 a_color;

uniform mat3 u_proj;            // 模型(分块局部) → 裁剪
uniform vec2 u_viewportSize;    // 设备像素
uniform float u_pxPerModel;     // 设备像素 / 模型单位
uniform float u_featherPx;      // 抗锯齿羽化宽度（像素）
// 设备像素 / CSS 像素：线宽是 CSS 像素语义（与 Canvas 引擎一致），
// 展开发生在设备像素空间，因此必须乘上该系数，否则 HiDPI 屏上线条只有一半粗细。
uniform float u_dprScale;

out vec4 v_color;
out float v_dist;        // 到中心线的有符号距离（像素）
out float v_halfWidth;   // 线半宽（像素）
out float v_feather;     // 抗锯齿斜坡半宽（像素）
out float v_arcLenPx;
out float v_dashIdx;

void main() {
    // 线宽是「CSS 像素」语义：几何半宽 = 线宽/2，不做 0.5px 的下限钳制。
    // 旧的 0.5px 半宽下限会让 0.5px 的细线被画成 1px（再加 0.5px 羽化共 1.5px），
    // 与 Canvas 引擎（0.5px 线宽）差 3 倍：密集小圆（直径 ~1px）会被描边完全盖住，
    // 实测渲染成一片实心黑块。
    float halfWidth = max(a_params.y * u_dprScale * 0.5, 0.125);
    // 抗锯齿斜坡以「真实边界」为中心：一半在墨迹内、一半在墨迹外，
    // 因此总墨量 ≈ 线宽（与 Canvas 引擎的原生 AA 一致）。
    // 旧实现把整个羽化宽度加在线外（墨迹 ≈ 线宽 + 羽化），细线会明显偏粗偏黑。
    float halfFeather = min(u_featherPx, halfWidth);
    float expanded = halfWidth + halfFeather;
    vec2 clipPos = (u_proj * vec3(a_pos, 1.0)).xy;
    // 斜接法线经投影线性部分变换到裁剪空间（自动处理 Y 翻转 / 旋转）。
    vec2 clipNormal = (u_proj * vec3(a_pos + a_normal, 1.0)).xy - clipPos;
    float normalLen = length(clipNormal);
    vec2 clipDir = normalLen > 1e-12 ? clipNormal / normalLen : vec2(0.0, 1.0);
    float extrudePx = abs(a_params.x) * expanded;
    vec2 extrudeClip = clipDir * a_params.x * expanded * (2.0 / u_viewportSize);
    gl_Position = vec4(clipPos + extrudeClip, 0.0, 1.0);
    v_color = a_color;
    // 片元中 |v_dist| ≈ 垂直于中心线的像素距离（顶点处等于展开半宽，跨四边形线性插值）。
    v_dist = a_params.x * expanded;
    v_halfWidth = halfWidth;
    v_feather = halfFeather;
    v_arcLenPx = a_params.z * u_pxPerModel;
    v_dashIdx = a_params.w;
}
`;

const LINE_FRAGMENT = /* glsl */`
precision highp float;

in vec4 v_color;
in float v_dist;
in float v_halfWidth;
in float v_feather;
in float v_arcLenPx;
in float v_dashIdx;

uniform float u_featherPx;
// 虚线模式表（当前绘制组的模式；dashIdx==0 时为实线）。
uniform float u_dashPeriod;    // 模型单位
uniform vec4 u_dashSegs;       // ≤4 段；>0 实线 / <0 空白 / 0 结束（模型单位）
uniform float u_pxPerModel;
// 选中覆盖色：alpha > 0 时忽略顶点色（选中高亮重描边用）。
uniform vec4 u_overrideColor;

out vec4 fragColor;

bool dashOn(float arcLenPx) {
    float periodPx = u_dashPeriod * u_pxPerModel;
    if (u_dashPeriod <= 0.0 || periodPx < 2.5) {
        return true; // 节距低于阈值：按实线绘制（与 CAD 概念一致，避免摩尔纹）
    }
    float s = mod(arcLenPx, periodPx);
    vec4 segs = u_dashSegs * u_pxPerModel;
    // 最多 4 段；绝对值给出长度，符号给出开/关。
    for (int i = 0; i < 4; i++) {
        float seg = i == 0 ? segs.x : i == 1 ? segs.y : i == 2 ? segs.z : segs.w;
        float len = abs(seg);
        if (len < 1e-6) break;
        if (s < len) return seg > 0.0;
        s -= len;
    }
    return true;
}

void main() {
    if (v_dashIdx > 0.5 && !dashOn(v_arcLenPx)) discard;
    float d = abs(v_dist);
    // 覆盖率：以真实边界（halfWidth）为界，斜坡一半在内、一半在外，
    // 墨量 ≈ 线宽（与 Canvas 引擎原生 AA 对齐）。
    float coverage = clamp((v_halfWidth + v_feather - d) / max(2.0 * v_feather, 1e-4), 0.0, 1.0);
    if (coverage <= 0.003) discard;
    vec4 base = u_overrideColor.a > 0.0
        ? vec4(u_overrideColor.rgb, u_overrideColor.a)
        : vec4(v_color.rgb, v_color.a);
    fragColor = vec4(base.rgb, base.a * coverage);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// fill：填充多边形
// ─────────────────────────────────────────────────────────────────────────────

const FILL_VERTEX = /* glsl */`
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_color;

uniform mat3 u_proj;
uniform vec2 u_chunkOrigin; // 分块局部坐标 → 模型（世界）坐标

out vec4 v_color;
out vec2 v_world;

void main() {
    gl_Position = vec4((u_proj * vec3(a_pos, 1.0)).xy, 0.0, 1.0);
    v_color = a_color;
    v_world = a_pos + u_chunkOrigin;
}
`;

const FILL_FRAGMENT = /* glsl */`
precision highp float;

in vec4 v_color;
in vec2 v_world;

// 填充模式：0 实心 / 1 单向剖面线 / 2 双向剖面线 / 3 点阵
uniform float u_fillMode;
uniform vec2 u_patternDir;     // 剖面线方向（单位向量，已含图案角度）
uniform float u_patternSpacing; // 模型单位
uniform float u_pxPerModel;
uniform vec4 u_overrideColor;
// 图案填充的多边形裁剪：外环 + 孔洞（偶奇规则）。
// u_clipPoly[0] = 外环点数，其后依次是各孔洞的点数与顶点对。
uniform vec4 u_clipPoly[64];   // 每项: (点数, 顶点起始下标, 0, 0)
uniform vec2 u_clipVerts[512]; // 顶点对（世界坐标）

out vec4 fragColor;

/** 偶奇规则的多边形包含判定（外环 + 孔洞）。 */
bool insideClipPolygon(vec2 p) {
    // 找到外环：clipPoly[0].x 为其点数，clipPoly[0].y 为顶点起始下标。
    int outerCount = int(u_clipPoly[0].x);
    int outerStart = int(u_clipPoly[0].y);
    if (outerCount < 3) return false;

    int crossings = 0;
    for (int i = 0; i < outerCount; i++) {
        int i0 = outerStart + i;
        int i1 = outerStart + ((i + 1 == outerCount) ? 0 : (i + 1));
        vec2 a = u_clipVerts[i0];
        vec2 b = u_clipVerts[i1];
        if ((a.y > p.y) != (b.y > p.y)) {
            float t = (p.y - a.y) / (b.y - a.y);
            if (p.x < a.x + t * (b.x - a.x)) crossings++;
        }
    }
    if ((crossings & 1) == 0) return false;

    // 孔洞：每个孔洞独立做偶奇判定（落在孔内则挖空）。
    for (int r = 1; r < 64; r++) {
        int cnt = int(u_clipPoly[r].x);
        if (cnt < 3) break;
        int st = int(u_clipPoly[r].y);
        int c2 = 0;
        for (int i = 0; i < cnt; i++) {
            int i0 = st + i;
            int i1 = st + ((i + 1 == cnt) ? 0 : (i + 1));
            vec2 a = u_clipVerts[i0];
            vec2 b = u_clipVerts[i1];
            if ((a.y > p.y) != (b.y > p.y)) {
                float t = (p.y - a.y) / (b.y - a.y);
                if (p.x < a.x + t * (b.x - a.x)) c2++;
            }
        }
        if ((c2 & 1) == 1) return false;
    }
    return true;
}

/** 单族剖面线覆盖率：到最近图案线的距离（像素）→ 0..1。 */
float lineFamilyCoverage(vec2 world, vec2 dir, float spacing) {
    float proj = dot(world, dir) / spacing;
    float f = abs(fract(proj) - 0.5) * spacing; // 到最近线中心的世界距离（0..spacing/2）
    float dPx = f * u_pxPerModel;
    return clamp(1.2 - dPx * 2.0, 0.0, 1.0);
}

float dotFamilyCoverage(vec2 world, vec2 dir, float spacing) {
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 cell = vec2(dot(world, dir) / spacing, dot(world, perp) / spacing);
    vec2 f = fract(cell) - 0.5;
    float dPx = length(f) * spacing * u_pxPerModel;
    return clamp(1.0 - dPx * 2.0, 0.0, 1.0);
}

void main() {
    if (u_overrideColor.a > 0.0) {
        fragColor = u_overrideColor;
        return;
    }
    float alpha = v_color.a;
    if (u_fillMode > 0.5 && u_patternSpacing > 1e-9) {
        // 多边形裁剪：剖面线只画在填充岛内部（含孔洞挖空）。
        // 没有裁剪数据时（u_clipPoly[0].x < 3）退化为整块包围盒填充。
        if (u_clipPoly[0].x >= 3.0 && !insideClipPolygon(v_world)) discard;
        float coverage;
        if (u_fillMode < 1.5) {
            coverage = lineFamilyCoverage(v_world, u_patternDir, u_patternSpacing);
        } else if (u_fillMode < 2.5) {
            vec2 perp = vec2(-u_patternDir.y, u_patternDir.x);
            coverage = max(
                lineFamilyCoverage(v_world, u_patternDir, u_patternSpacing),
                lineFamilyCoverage(v_world, perp, u_patternSpacing * 2.0));
        } else {
            coverage = dotFamilyCoverage(v_world, u_patternDir, u_patternSpacing * 3.0);
        }
        // 密度衰减：图案间距在屏幕上小于 ~4px 时按比例退化为半透明底色，
        // 避免远视图摩尔纹/灰块（与 CAD 打印的浅色表现一致）。
        float spacingPx = u_patternSpacing * u_pxPerModel;
        float density = clamp((spacingPx - 1.5) / 3.0, 0.0, 1.0);
        if (coverage <= 0.004) discard;
        alpha *= coverage * mix(0.28, 1.0, density);
    }
    fragColor = vec4(v_color.rgb, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// glyph：文字图集
// ─────────────────────────────────────────────────────────────────────────────

const GLYPH_VERTEX = /* glsl */`
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;
layout(location=3) in float a_page;

uniform mat3 u_proj;

out vec2 v_uv;
out vec4 v_color;
out float v_page;

void main() {
    gl_Position = vec4((u_proj * vec3(a_pos, 1.0)).xy, 0.0, 1.0);
    v_uv = a_uv;
    v_color = a_color;
    v_page = a_page;
}
`;

const GLYPH_FRAGMENT = /* glsl */`
precision mediump float;
precision mediump sampler2DArray;

in vec2 v_uv;
in vec4 v_color;
in float v_page;

uniform sampler2DArray u_atlas;
uniform vec4 u_overrideColor;

out vec4 fragColor;

void main() {
    // 图集存的是有向距离场（0.5 = 字形边缘）。用屏幕空间导数自适应过渡宽度，
    // 任意缩放级别下边缘都保持 1px 左右的抗锯齿，不会糊也不会锯齿。
    float dist = texture(u_atlas, vec3(v_uv, v_page)).r;
    float w = max(fwidth(dist) * 0.75, 0.0015);
    float mask = smoothstep(0.5 - w, 0.5 + w, dist);
    float alpha = (u_overrideColor.a > 0.0 ? u_overrideColor.a : v_color.a) * mask;
    if (alpha <= 0.004) discard;
    vec3 rgb = u_overrideColor.a > 0.0 ? u_overrideColor.rgb : v_color.rgb;
    fragColor = vec4(rgb, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// point：点实体
// ─────────────────────────────────────────────────────────────────────────────

const POINT_VERTEX = /* glsl */`
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_color;

uniform mat3 u_proj;
uniform float u_pointSizePx;

out vec4 v_color;

void main() {
    gl_Position = vec4((u_proj * vec3(a_pos, 1.0)).xy, 0.0, 1.0);
    gl_PointSize = u_pointSizePx;
    v_color = a_color;
}
`;

const POINT_FRAGMENT = /* glsl */`
precision mediump float;

in vec4 v_color;
out vec4 fragColor;

void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float coverage = clamp((1.0 - r2) * 2.0, 0.0, 1.0);
    fragColor = vec4(v_color.rgb, v_color.a * coverage);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// grid：自适应栅格背景
// ─────────────────────────────────────────────────────────────────────────────

const GRID_VERTEX = /* glsl */`
layout(location=0) in vec2 a_corner; // 全屏三角形角点 (-1..3)

uniform mat3 u_projInv; // 裁剪 → 模型

out vec2 v_world;

void main() {
    vec2 clip = a_corner;
    gl_Position = vec4(clip, 0.0, 1.0);
    v_world = (u_projInv * vec3(clip, 1.0)).xy;
}
`;

const GRID_FRAGMENT = /* glsl */`
precision highp float;

in vec2 v_world;

uniform float u_pxPerModel;
uniform vec3 u_gridMinor;   // 次栅格线颜色
uniform vec3 u_gridMajor;   // 主栅格线颜色
uniform vec3 u_axisX;       // X 轴颜色
uniform vec3 u_axisY;       // Y 轴颜色
uniform float u_gridStepPx; // 主栅格目标间距（像素）
uniform float u_opacity;
uniform float u_axesEnabled;

out vec4 fragColor;

/** 取 1/2/5×10^n 的“好看”步长（模型单位），使投影后间距接近目标像素。 */
float niceStepPx(float targetPx) {
    float raw = targetPx / u_pxPerModel;
    // GLSL ES 无 log10：log2(x)/log2(10) 等价。
    float mag = floor(log2(max(raw, 1e-30)) / 3.3219280948873623);
    float base = pow(10.0, mag);
    float norm = raw / base;
    float mult = norm < 1.5 ? 1.0 : norm < 3.5 ? 2.0 : norm < 7.5 ? 5.0 : 10.0;
    return mult * base;
}

float gridLineIntensity(vec2 world, float step, float halfWidthPx) {
    vec2 grid = abs(fract(world / step - 0.5) - 0.5) * step * u_pxPerModel;
    float d = min(grid.x, grid.y);
    return clamp(1.0 - d / halfWidthPx, 0.0, 1.0);
}

void main() {
    float majorStep = niceStepPx(u_gridStepPx);
    float minorStep = majorStep * 0.1;

    float minor = gridLineIntensity(v_world, minorStep, 0.5);
    float major = gridLineIntensity(v_world, majorStep, 0.7);

    vec3 color = u_gridMinor * minor * 0.5 + u_gridMajor * major;
    float alpha = max(minor * 0.35, major * 0.75) * u_opacity;

    // 坐标轴（过原点的主栅格线，CAD 惯例红/绿）
    if (u_axesEnabled > 0.5) {
        float axisW = 1.0 / u_pxPerModel;
        if (abs(v_world.y) < axisW) {
            color = u_axisX;
            alpha = max(alpha, 0.9 * u_opacity);
        } else if (abs(v_world.x) < axisW) {
            color = u_axisY;
            alpha = max(alpha, 0.9 * u_opacity);
        }
    }

    if (alpha <= 0.004) discard;
    fragColor = vec4(color, alpha);
}
`;

export interface ShaderSources {
  line: { vertex: string; fragment: string };
  fill: { vertex: string; fragment: string };
  glyph: { vertex: string; fragment: string };
  point: { vertex: string; fragment: string };
  grid: { vertex: string; fragment: string };
}

export const SHADER_SOURCES: ShaderSources = {
  line: { vertex: COMMON + LINE_VERTEX, fragment: COMMON + LINE_FRAGMENT },
  fill: { vertex: COMMON + FILL_VERTEX, fragment: COMMON + FILL_FRAGMENT },
  glyph: { vertex: COMMON + GLYPH_VERTEX, fragment: COMMON + GLYPH_FRAGMENT },
  point: { vertex: COMMON + POINT_VERTEX, fragment: COMMON + POINT_FRAGMENT },
  grid: { vertex: COMMON + GRID_VERTEX, fragment: COMMON + GRID_FRAGMENT },
};


