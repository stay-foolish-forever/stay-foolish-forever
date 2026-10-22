// SeasonScene 动态层的 WebGL2 渲染器。
// 所有每帧运动由着色器内的时间函数驱动：CPU 每帧只更新少量 uniform，
// 实例缓冲只在 resize / 换季 / 换天气 / 换主题时重打包。
// 静态景物（天空/日月/山/地面/森林/帐篷/篝火架/花）由 2D 离屏 canvas
// 烘焙成纹理，每帧以单个全屏三角形合成。

export interface StarP {
	x: number;
	y: number;
	r: number;
	phase: number;
	speed: number;
}
export interface BladeP {
	x: number;
	y: number;
	len: number;
	phase: number;
	shade: number;
}
export interface LeafP {
	x0: number;
	y0: number;
	fall: number;
	vy: number;
	phase: number;
	rot0: number;
	vr: number;
	size: number;
	tint: number;
}
export interface CloudP {
	x: number;
	y: number;
	scale: number;
	vx: number;
}
export interface CloudGroup {
	clouds: CloudP[];
	color: [number, number, number, number];
}
export interface SmokeSeed {
	x: number;
	y: number;
	phase: number;
}
export interface RainP {
	x: number;
	vy: number;
	len: number;
	off: number;
}
export interface SnowP {
	x: number;
	y: number;
	vy: number;
	size: number;
	phase: number;
}
export interface FireflyP {
	ax: number;
	ay: number;
	phase: number;
	size: number;
}

export interface RenderParams {
	t: number; // 相对首帧的毫秒
	w: number;
	h: number;
	dpr: number;
	night: boolean;
	weather: string;
	windDist: number; // 云层漂移积分（帧单位）
	amp: number; // 草摆动幅度
	flick: number; // 火焰跳动系数
	windK: number; // 落叶风倍率
	drift: number; // 炊烟单周期漂移总量（px）
	grassA: string;
	grassB: string;
}

export interface SceneRenderer {
	uploadStatic(source: HTMLCanvasElement): void;
	packStars(stars: StarP[]): void;
	packGrass(blades: BladeP[]): void;
	packLeaves(leaves: LeafP[], colors: [number, number, number, number][]): void;
	packClouds(groups: CloudGroup[]): void;
	packFlame(fx: number, fy: number, s: number): void;
	packSmoke(seeds: SmokeSeed[]): void;
	packRain(drops: RainP[]): void;
	packSnow(flakes: SnowP[]): void;
	packFireflies(fireflies: FireflyP[]): void;
	render(p: RenderParams): void;
}

// 像素坐标（CSS px）→ 裁剪空间，所有顶点着色器共用
const COMMON = `
uniform vec2 uRes;
vec2 toClip(vec2 p) {
	vec2 c = p / uRes * 2.0 - 1.0;
	return vec2(c.x, -c.y);
}
`;

// 全屏三角形（gl_VertexID 生成，无顶点缓冲）；canvas 首行对应纹理 v=0，需翻转
const TEX_VS = `
out vec2 vUv;
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	vUv = vec2(p.x, 1.0 - p.y);
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
const TEX_FS = `
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() {
	outColor = texture(uTex, vUv);
}
`;

// 星星 / 雪共用：圆点片元
const POINT_FS = `
uniform vec4 uColor;
in float vAlpha;
out vec4 outColor;
void main() {
	float d = length(gl_PointCoord - 0.5) * 2.0;
	float a = (1.0 - smoothstep(0.75, 1.0, d)) * vAlpha * uColor.a;
	outColor = vec4(uColor.rgb * a, a);
}
`;

const STAR_VS = `
in vec2 aPos;
in float aR;
in float aPhase;
in float aSpeed;
uniform float uTime;
uniform float uDpr;
out float vAlpha;
void main() {
	vAlpha = 0.3 + 0.7 * abs(sin(uTime * aSpeed + aPhase));
	gl_Position = vec4(toClip(aPos), 0.0, 1.0);
	gl_PointSize = aR * 2.0 * uDpr;
}
`;

const SNOW_VS = `
in vec2 aSeed;
in vec3 aCfg;
uniform float uTime;
uniform float uDpr;
out float vAlpha;
void main() {
	float y = mod(aSeed.y + 0.06 * aCfg.x * uTime, uRes.y + 20.0) - 10.0;
	float x = aSeed.x + 12.0 * sin(0.0008 * uTime + aCfg.z);
	vAlpha = 1.0;
	gl_Position = vec4(toClip(vec2(x, y)), 0.0, 1.0);
	gl_PointSize = aCfg.y * 2.0 * uDpr;
}
`;

const FIREFLY_VS = `
in vec2 aHome;
in float aPhase;
in float aSize;
uniform float uTime;
uniform float uDpr;
out float vAlpha;
void main() {
	vec2 p = aHome + vec2(
		34.0 * sin(0.0006 * uTime + aPhase),
		18.0 * cos(0.0008 * uTime + aPhase * 1.7));
	vAlpha = 0.4 + 0.6 * abs(sin(0.002 * uTime + aPhase));
	gl_Position = vec4(toClip(p), 0.0, 1.0);
	gl_PointSize = aSize * 7.0 * uDpr;
}
`;
// 单点精灵同时画核心与辉光：内圈亮核，外圈光晕
const FIREFLY_FS = `
in float vAlpha;
out vec4 outColor;
void main() {
	float r = length(gl_PointCoord - 0.5) * 2.0;
	float core = 1.0 - smoothstep(0.2, 0.29, r);
	float glow = 1.0 - smoothstep(0.29, 1.0, r);
	float a = vAlpha * (0.9 * core + 0.16 * glow);
	vec3 col = mix(vec3(0.745, 1.0, 0.471), vec3(0.863, 1.0, 0.588), core);
	outColor = vec4(col * a, a);
}
`;

// 草叶：3 段条带逼近二次贝塞尔，弯曲在顶点着色器里算
const GRASS_VS = `
in vec2 aVert;
in vec2 aBase;
in float aLen;
in float aPhase;
in float aShade;
uniform float uTime;
uniform float uAmp;
uniform vec3 uColA;
uniform vec3 uColB;
out vec3 vColor;
out float vEdge;
void main() {
	float bend = sin(uTime * 0.0016 + aPhase + aBase.x * 0.008) * uAmp;
	vec2 p0 = aBase;
	vec2 p1 = aBase + vec2(bend * 0.4, -aLen * 0.6);
	vec2 p2 = aBase + vec2(bend, -aLen);
	float t = aVert.y;
	vec2 pos = mix(mix(p0, p1, t), mix(p1, p2, t), t);
	vec2 deriv = 2.0 * (1.0 - t) * (p1 - p0) + 2.0 * t * (p2 - p1);
	vec2 n = normalize(vec2(-deriv.y, deriv.x));
	pos += n * aVert.x * 0.8;
	vColor = mix(uColA, uColB, aShade);
	vEdge = aVert.x;
	gl_Position = vec4(toClip(pos), 0.0, 1.0);
}
`;
const GRASS_FS = `
in vec3 vColor;
in float vEdge;
out vec4 outColor;
void main() {
	float a = 1.0 - smoothstep(0.6, 1.0, abs(vEdge));
	outColor = vec4(vColor * a, a);
}
`;

// 落叶：旋转椭圆，位置/角度均为时间的纯函数
const LEAF_VS = `
in vec2 aCorner;
in vec4 aInfo;
in vec4 aInfo2;
in vec4 aColor;
uniform float uTime;
uniform float uWindK;
out vec2 vLocal;
out vec4 vColor;
void main() {
	float tt = mod(0.06 * aInfo.w * uTime, aInfo.z);
	float y = aInfo.y + tt;
	float x = aInfo.x + 28.0 * uWindK * sin(0.0015 * uTime + aInfo2.x);
	float rot = aInfo2.y + aInfo2.z * uWindK * 0.06 * uTime;
	vec2 c = aCorner * vec2(aInfo2.w, aInfo2.w * 0.6);
	vec2 rc = vec2(c.x * cos(rot) - c.y * sin(rot), c.x * sin(rot) + c.y * cos(rot));
	vLocal = aCorner;
	vColor = aColor;
	gl_Position = vec4(toClip(vec2(x, y) + rc), 0.0, 1.0);
}
`;
// 边缘衰减取 ~1.5 物理像素宽（fwidth），不随椭圆尺寸成比例放宽，云朵轮廓保持清晰
const ELLIPSE_FS = `
in vec2 vLocal;
in vec4 vColor;
out vec4 outColor;
void main() {
	float d = length(vLocal);
	float aa = fwidth(d) * 1.5;
	float a = (1.0 - smoothstep(1.0 - aa, 1.0, d)) * vColor.a;
	outColor = vec4(vColor.rgb * a, a);
}
`;

// 云团（漂移环绕）与火焰（flicker 缩放 ry）共用的椭圆批次
const ELLIPSE_VS = `
in vec2 aCorner;
in vec4 aPos;
in vec4 aShape;
in vec4 aColor;
uniform float uWindDist;
uniform float uFlick;
out vec2 vLocal;
out vec4 vColor;
void main() {
	float range = uRes.x + 160.0 * aPos.w;
	float cx = aPos.w > 0.0
		? mod(aPos.x + aShape.z * uWindDist + 80.0 * aPos.w, range) - 80.0 * aPos.w + aPos.y
		: aPos.x + aPos.y;
	float ry = aShape.y * mix(1.0, uFlick, aShape.w);
	vec2 pos = vec2(cx, aPos.z) + aCorner * vec2(aShape.x, ry);
	vLocal = aCorner;
	vColor = aColor;
	gl_Position = vec4(toClip(pos), 0.0, 1.0);
}
`;

// 炊烟：单周期内上升、膨胀、变淡，相位错开形成连续烟柱
const SMOKE_VS = `
in vec2 aCorner;
in vec3 aSeed;
uniform float uTime;
uniform float uDrift;
out vec2 vLocal;
out float vAlpha;
void main() {
	float c = fract(uTime / 2183.0 + aSeed.z);
	float y = aSeed.y - 72.0 * c;
	float r = mix(3.0, 19.0, c);
	float x = aSeed.x + uDrift * c + 3.0 * sin(y * 0.05);
	vLocal = aCorner;
	vAlpha = 0.42 * (1.0 - c);
	gl_Position = vec4(toClip(vec2(x, y) + aCorner * r), 0.0, 1.0);
}
`;
const SMOKE_FS = `
in vec2 vLocal;
in float vAlpha;
out vec4 outColor;
void main() {
	float a = vAlpha * (1.0 - smoothstep(0.8, 1.0, length(vLocal)));
	outColor = vec4(vec3(0.804) * a, a);
}
`;

// 雨滴：斜切细四边形，下落与横移在同一周期内循环
const RAIN_VS = `
in vec2 aVert;
in vec3 aDrop;
in float aOff;
uniform float uTime;
out float vEdge;
out float vTail;
void main() {
	float fall = uRes.y + 40.0;
	float tt = mod(0.06 * aDrop.y * uTime + aOff, fall);
	float y = -20.0 + tt;
	float x = aDrop.x - 1.2 * tt / aDrop.y;
	vec2 pos = mix(vec2(x, y), vec2(x - 2.0, y + aDrop.z), aVert.y);
	pos.x += aVert.x * 1.6;
	vEdge = aVert.x * 2.0;
	vTail = aVert.y;
	gl_Position = vec4(toClip(pos), 0.0, 1.0);
}
`;
const RAIN_FS = `
uniform vec4 uColor;
in float vEdge;
in float vTail;
out vec4 outColor;
void main() {
	float a = (1.0 - smoothstep(0.9, 1.0, abs(vEdge))) * uColor.a;
	a *= 0.45 + 0.55 * vTail;
	outColor = vec4(uColor.rgb * a, a);
}
`;

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
const RAIN_GEOM = new Float32Array([-0.5, 0, 0.5, 0, -0.5, 1, -0.5, 1, 0.5, 0, 0.5, 1]);
// 草叶条带：t ∈ {0, 1/3, 2/3, 1} × side ±1，共 6 个三角形
const bladeGeom = () => {
	const t = [0, 1 / 3, 2 / 3, 1];
	const out: number[] = [];
	for (let i = 0; i < 3; i++) {
		const t0 = t[i];
		const t1 = t[i + 1];
		out.push(-1, t0, 1, t0, -1, t1, -1, t1, 1, t0, 1, t1);
	}
	return new Float32Array(out);
};

// 云团的 6 个圆块：[偏移x, 偏移y, 半径x, 半径y]（单位 scale）
const CLOUD_BLOBS: [number, number, number, number][] = [
	[0, 10, 46, 15],
	[-30, 2, 18, 18],
	[-12, -12, 24, 24],
	[12, -14, 26, 26],
	[32, -2, 19, 19],
	[2, -4, 24, 24],
];

const hexRgb = (hex: string): [number, number, number] => {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

interface Pack {
	prog: WebGLProgram;
	vao: WebGLVertexArrayObject;
	instBuf: WebGLBuffer;
	mode: number;
	geomCount: number;
	instFloats: number;
	instCount: number;
	locs: Map<string, WebGLUniformLocation | null>;
}

export const createRenderer = (canvas: HTMLCanvasElement): SceneRenderer | null => {
	const gl = canvas.getContext('webgl2', {
		alpha: true,
		premultipliedAlpha: true,
		depth: false,
		stencil: false,
		antialias: false,
		powerPreference: 'low-power',
	});
	if (!gl) return null;

	try {
		const buildShader = (type: number, src: string) => {
			const sh = gl.createShader(type)!;
			gl.shaderSource(sh, `#version 300 es\nprecision highp float;\n${src}`);
			gl.compileShader(sh);
			if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
				throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
			}
			return sh;
		};
		const buildProgram = (vs: string, fs: string) => {
			const prog = gl.createProgram()!;
			gl.attachShader(prog, buildShader(gl.VERTEX_SHADER, vs));
			gl.attachShader(prog, buildShader(gl.FRAGMENT_SHADER, fs));
			gl.linkProgram(prog);
			if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
				throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed');
			}
			return prog;
		};
		const bindAttrs = (prog: WebGLProgram, attrs: [string, number][], divisor: number) => {
			const stride = attrs.reduce((s, [, size]) => s + size, 0) * 4;
			let offset = 0;
			for (const [name, size] of attrs) {
				const loc = gl.getAttribLocation(prog, name);
				if (loc >= 0) {
					gl.enableVertexAttribArray(loc);
					gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
					gl.vertexAttribDivisor(loc, divisor);
				}
				offset += size * 4;
			}
		};
		const makePack = (
			vsSrc: string,
			fsSrc: string,
			geom: Float32Array | null,
			geomAttrs: [string, number][],
			instAttrs: [string, number][],
			instFloats: number,
			mode: number,
		): Pack => {
			const prog = buildProgram(vsSrc, fsSrc);
			const vao = gl.createVertexArray()!;
			gl.bindVertexArray(vao);
			let geomCount = 1;
			if (geom) {
				geomCount = geom.length / geomAttrs.reduce((s, [, size]) => s + size, 0);
				const buf = gl.createBuffer()!;
				gl.bindBuffer(gl.ARRAY_BUFFER, buf);
				gl.bufferData(gl.ARRAY_BUFFER, geom, gl.STATIC_DRAW);
				bindAttrs(prog, geomAttrs, 0);
			}
			const instBuf = gl.createBuffer()!;
			gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
			gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
			bindAttrs(prog, instAttrs, 1);
			gl.bindVertexArray(null);
			return { prog, vao, instBuf, mode, geomCount, instFloats, instCount: 0, locs: new Map() };
		};
		const setInstances = (pack: Pack, data: Float32Array) => {
			gl.bindBuffer(gl.ARRAY_BUFFER, pack.instBuf);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
			pack.instCount = data.length / pack.instFloats;
		};
		const uloc = (pack: Pack, name: string) => {
			if (!pack.locs.has(name)) pack.locs.set(name, gl.getUniformLocation(pack.prog, name));
			return pack.locs.get(name) ?? null;
		};
		const withPack = (pack: Pack, set: () => void) => {
			if (!pack.instCount) return;
			gl.useProgram(pack.prog);
			set();
			gl.bindVertexArray(pack.vao);
			gl.drawArraysInstanced(pack.mode, 0, pack.geomCount, pack.instCount);
			gl.bindVertexArray(null);
		};

		const texProg = buildProgram(TEX_VS, TEX_FS);
		gl.useProgram(texProg);
		gl.uniform1i(gl.getUniformLocation(texProg, 'uTex'), 0);

		const starsPack = makePack(
			COMMON + STAR_VS, POINT_FS, null, [],
			[['aPos', 2], ['aR', 1], ['aPhase', 1], ['aSpeed', 1]], 5, gl.POINTS,
		);
		const snowPack = makePack(
			COMMON + SNOW_VS, POINT_FS, null, [],
			[['aSeed', 2], ['aCfg', 3]], 5, gl.POINTS,
		);
		const fireflyPack = makePack(
			COMMON + FIREFLY_VS, FIREFLY_FS, null, [],
			[['aHome', 2], ['aPhase', 1], ['aSize', 1]], 4, gl.POINTS,
		);
		const grassPack = makePack(
			COMMON + GRASS_VS, GRASS_FS, bladeGeom(), [['aVert', 2]],
			[['aBase', 2], ['aLen', 1], ['aPhase', 1], ['aShade', 1]], 5, gl.TRIANGLES,
		);
		const leavesPack = makePack(
			COMMON + LEAF_VS, ELLIPSE_FS, QUAD, [['aCorner', 2]],
			[['aInfo', 4], ['aInfo2', 4], ['aColor', 4]], 12, gl.TRIANGLES,
		);
		const cloudPack = makePack(
			COMMON + ELLIPSE_VS, ELLIPSE_FS, QUAD, [['aCorner', 2]],
			[['aPos', 4], ['aShape', 4], ['aColor', 4]], 12, gl.TRIANGLES,
		);
		const flamePack = makePack(
			COMMON + ELLIPSE_VS, ELLIPSE_FS, QUAD, [['aCorner', 2]],
			[['aPos', 4], ['aShape', 4], ['aColor', 4]], 12, gl.TRIANGLES,
		);
		const smokePack = makePack(
			COMMON + SMOKE_VS, SMOKE_FS, QUAD, [['aCorner', 2]],
			[['aSeed', 3]], 3, gl.TRIANGLES,
		);
		const rainPack = makePack(
			COMMON + RAIN_VS, RAIN_FS, RAIN_GEOM, [['aVert', 2]],
			[['aDrop', 3], ['aOff', 1]], 4, gl.TRIANGLES,
		);

		const staticTex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, staticTex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		return {
			uploadStatic(source) {
				gl.bindTexture(gl.TEXTURE_2D, staticTex);
				gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
			},
			packStars(stars) {
				const data: number[] = [];
				for (const s of stars) data.push(s.x, s.y, s.r, s.phase, s.speed);
				setInstances(starsPack, new Float32Array(data));
			},
			packGrass(blades) {
				const data: number[] = [];
				for (const b of blades) data.push(b.x, b.y, b.len, b.phase, b.shade);
				setInstances(grassPack, new Float32Array(data));
			},
			packLeaves(leaves, colors) {
				const data: number[] = [];
				for (const f of leaves) {
					const col = colors[Math.floor(f.tint * colors.length)] ?? colors[0];
					data.push(f.x0, f.y0, f.fall, f.vy, f.phase, f.rot0, f.vr, f.size, ...col);
				}
				setInstances(leavesPack, new Float32Array(data));
			},
			packClouds(groups) {
				const data: number[] = [];
				for (const g of groups) {
					for (const c of g.clouds) {
						for (const [px, py, rx, ry] of CLOUD_BLOBS) {
							data.push(c.x, px * c.scale, c.y + py * c.scale, c.scale, rx * c.scale, ry * c.scale, c.vx, 0, ...g.color);
						}
					}
				}
				setInstances(cloudPack, new Float32Array(data));
			},
			packFlame(fx, fy, s) {
				setInstances(flamePack, new Float32Array([
					fx, 0, fy - 7 * s, 0, 5 * s, 7 * s, 0, 1, 1, 0.549, 0.157, 0.9,
					fx, 0, fy - 5 * s, 0, 2.6 * s, 4 * s, 0, 1, 1, 0.839, 0.353, 0.95,
				]));
			},
			packSmoke(seeds) {
				const data: number[] = [];
				for (const s of seeds) data.push(s.x, s.y, s.phase);
				setInstances(smokePack, new Float32Array(data));
			},
			packRain(drops) {
				const data: number[] = [];
				for (const r of drops) data.push(r.x, r.vy, r.len, r.off);
				setInstances(rainPack, new Float32Array(data));
			},
			packSnow(flakes) {
				const data: number[] = [];
				for (const s of flakes) data.push(s.x, s.y, s.vy, s.size, s.phase);
				setInstances(snowPack, new Float32Array(data));
			},
			packFireflies(fireflies) {
				const data: number[] = [];
				for (const f of fireflies) data.push(f.ax, f.ay, f.phase, f.size);
				setInstances(fireflyPack, new Float32Array(data));
			},
			render(p) {
				gl.viewport(0, 0, canvas.width, canvas.height);
				gl.clearColor(0, 0, 0, 0);
				gl.clear(gl.COLOR_BUFFER_BIT);

				gl.disable(gl.BLEND);
				gl.useProgram(texProg);
				gl.bindVertexArray(null);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, staticTex);
				gl.drawArrays(gl.TRIANGLES, 0, 3);

				gl.enable(gl.BLEND);
				gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

				if (p.night) {
					withPack(starsPack, () => {
						gl.uniform2f(uloc(starsPack, 'uRes'), p.w, p.h);
						gl.uniform1f(uloc(starsPack, 'uTime'), p.t);
						gl.uniform1f(uloc(starsPack, 'uDpr'), p.dpr);
						gl.uniform4f(uloc(starsPack, 'uColor'), 0.9098, 0.9255, 0.9686, 1);
					});
				}

				withPack(cloudPack, () => {
					gl.uniform2f(uloc(cloudPack, 'uRes'), p.w, p.h);
					gl.uniform1f(uloc(cloudPack, 'uWindDist'), p.windDist);
					gl.uniform1f(uloc(cloudPack, 'uFlick'), p.flick);
				});

				const [gaR, gaG, gaB] = hexRgb(p.grassA);
				const [gbR, gbG, gbB] = hexRgb(p.grassB);
				withPack(grassPack, () => {
					gl.uniform2f(uloc(grassPack, 'uRes'), p.w, p.h);
					gl.uniform1f(uloc(grassPack, 'uTime'), p.t);
					gl.uniform1f(uloc(grassPack, 'uAmp'), p.amp);
					gl.uniform3f(uloc(grassPack, 'uColA'), gaR, gaG, gaB);
					gl.uniform3f(uloc(grassPack, 'uColB'), gbR, gbG, gbB);
				});

				withPack(leavesPack, () => {
					gl.uniform2f(uloc(leavesPack, 'uRes'), p.w, p.h);
					gl.uniform1f(uloc(leavesPack, 'uTime'), p.t);
					gl.uniform1f(uloc(leavesPack, 'uWindK'), p.windK);
				});

				if (!p.night) {
					withPack(flamePack, () => {
						gl.uniform2f(uloc(flamePack, 'uRes'), p.w, p.h);
						gl.uniform1f(uloc(flamePack, 'uWindDist'), p.windDist);
						gl.uniform1f(uloc(flamePack, 'uFlick'), p.flick);
					});
					withPack(smokePack, () => {
						gl.uniform2f(uloc(smokePack, 'uRes'), p.w, p.h);
						gl.uniform1f(uloc(smokePack, 'uTime'), p.t);
						gl.uniform1f(uloc(smokePack, 'uDrift'), p.drift);
					});
				}

				withPack(fireflyPack, () => {
					gl.uniform2f(uloc(fireflyPack, 'uRes'), p.w, p.h);
					gl.uniform1f(uloc(fireflyPack, 'uTime'), p.t);
					gl.uniform1f(uloc(fireflyPack, 'uDpr'), p.dpr);
				});

				if (p.weather === 'rain') {
					withPack(rainPack, () => {
						gl.uniform2f(uloc(rainPack, 'uRes'), p.w, p.h);
						gl.uniform1f(uloc(rainPack, 'uTime'), p.t);
						if (p.night) gl.uniform4f(uloc(rainPack, 'uColor'), 0.588, 0.667, 0.784, 0.45);
						else gl.uniform4f(uloc(rainPack, 'uColor'), 0.62, 0.698, 0.804, 0.6);
					});
				} else if (p.weather === 'snow') {
					withPack(snowPack, () => {
						gl.uniform2f(uloc(snowPack, 'uRes'), p.w, p.h);
						gl.uniform1f(uloc(snowPack, 'uTime'), p.t);
						gl.uniform1f(uloc(snowPack, 'uDpr'), p.dpr);
						gl.uniform4f(uloc(snowPack, 'uColor'), 1, 1, 1, 0.85);
					});
				}
			},
		};
	} catch {
		return null;
	}
};
