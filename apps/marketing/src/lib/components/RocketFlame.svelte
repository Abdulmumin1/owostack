<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as THREE from "three";
  import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
  import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
  import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

  let container: HTMLDivElement;
  let isDestroyed = false;
  let isInitialized = false;
  let animationFrameId: number | undefined;
  let renderer: THREE.WebGLRenderer;
  let handleResize: () => void;
  let handleMouseMove: (e: MouseEvent) => void;
  let handleMouseLeave: () => void;
  let handleDocumentVisibility: () => void;
  let handleThemeChange: (() => void) | undefined;
  let syncAnimation = () => {};
  let themeObserver: MutationObserver | undefined;
  let visibilityObserver: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let colorSchemeMediaQuery: MediaQueryList | undefined;
  let initializationPromise: Promise<void> | undefined;
  let isLightMode = false;
  let isVisible = false;
  let isDocumentVisible = true;
  let shouldAnimate = false;

  type FlameQualityProfile = {
    gridSize: number;
    renderScale: number;
    pixelRatioCap: number;
    pressureIterations: number;
    raySteps: number;
    targetFps: number;
    bodySegments: number;
    nozzleSegments: number;
    ringSegments: number;
    pipeSegments: number;
    helixSegments: number;
  };

  function getQualityProfile(): FlameQualityProfile {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const compactViewport = Math.min(window.innerWidth, window.innerHeight) < 820;

    if (prefersReducedMotion) {
      return {
        gridSize: 36,
        renderScale: 0.72,
        pixelRatioCap: 1,
        pressureIterations: 7,
        raySteps: 48,
        targetFps: 24,
        bodySegments: 16,
        nozzleSegments: 12,
        ringSegments: 16,
        pipeSegments: 8,
        helixSegments: 24,
      };
    }

    if (hasCoarsePointer || compactViewport) {
      return {
        gridSize: 40,
        renderScale: 0.9,
        pixelRatioCap: 1.1,
        pressureIterations: 8,
        raySteps: 56,
        targetFps: 22,
        bodySegments: 18,
        nozzleSegments: 14,
        ringSegments: 18,
        pipeSegments: 9,
        helixSegments: 28,
      };
    }

    return {
      gridSize: 48,
      renderScale: 0.85,
      pixelRatioCap: 1.25,
      pressureIterations: 10,
      raySteps: 64,
      targetFps: 30,
      bodySegments: 24,
      nozzleSegments: 16,
      ringSegments: 20,
      pipeSegments: 10,
      helixSegments: 36,
    };
  }

  async function initializeFlame() {
    if (!container || isInitialized || isDestroyed) return;

    if (!container) return;
    const quality = getQualityProfile();
    let lastFrameTime = 0;
    let elapsedTime = 0;

    // ── Renderer ──
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    const rect = container.getBoundingClientRect();
    const scaledWidth = Math.max(1, Math.round(rect.width * quality.renderScale));
    const scaledHeight = Math.max(
      1,
      Math.round(rect.height * quality.renderScale),
    );
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
    renderer.setSize(scaledWidth, scaledHeight, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    // Transparent background
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // ── Simulation parameters ──
    const params = {
      buoyancy: -2.8,
      turbulence: 4.2,
      swirl: 0.15,
      emitRadius: 0.09,
      emitDensity: 7.0,
      emitTemperature: 1.8,
      velocityDissipation: 0.952,
      densityDissipation: 0.968,
      temperatureDissipation: 0.994,
      pressureIterations: quality.pressureIterations,
      simSpeed: 2.2,
    };

    // ── Camera & controls ──
    const camera = new THREE.PerspectiveCamera(
      35, // Lower FOV to zoom in a bit
      rect.width / rect.height,
      0.1,
      100,
    );
    // Move camera lower (y) and closer (z) to point up at the nozzles
    camera.position.set(0, -1.4, 3.1);
    camera.lookAt(0, 0, 0);

    // ── Mouse interaction ──
    const mouse = new THREE.Vector2(0, 0);
    const prevMouse = new THREE.Vector2(0, 0);
    const mouseWorld3D = new THREE.Vector3(0.5, 0.5, 0.5);
    let mouseActive = false;

    const raycaster = new THREE.Raycaster();

    handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      prevMouse.set(nx, ny);
      mouse.set(nx, ny);
      mouseActive = true;
    };

    handleMouseLeave = () => {
      mouseActive = false;
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);

    // ── 3D texture atlas dimensions ──
    const GRID_SIZE = quality.gridSize;
    const SLICES_PER_ROW = 8;
    const ATLAS_RES = GRID_SIZE * SLICES_PER_ROW;

    // ── Render target factory ──
    function createRenderTarget() {
      return new THREE.WebGLRenderTarget(ATLAS_RES, ATLAS_RES, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
      });
    }

    // ── Shared GLSL for 3D texture atlas sampling ──
    const GLSL_ATLAS = `
      const float GRID = ${GRID_SIZE}.0;
      const float SPR  = ${SLICES_PER_ROW}.0;
      const float AR   = ${ATLAS_RES}.0;

      vec4 sample3D(sampler2D tex, vec3 uvw) {
        vec3 c = clamp(uvw, vec3(0.5 / GRID), vec3(1.0 - 0.5 / GRID));
        float slice   = c.z * (GRID - 1.0);
        float slice0  = floor(slice);
        float slice1  = min(slice0 + 1.0, GRID - 1.0);
        vec2 localUV  = c.xy * (GRID / AR);
        float row0 = floor(slice0 / SPR), col0 = slice0 - row0 * SPR;
        float row1 = floor(slice1 / SPR), col1 = slice1 - row1 * SPR;
        vec4 s0 = texture2D(tex, vec2(col0, row0) * GRID / AR + localUV);
        vec4 s1 = texture2D(tex, vec2(col1, row1) * GRID / AR + localUV);
        return mix(s0, s1, slice - slice0);
      }

      vec3 toUVW(vec2 uv) {
        vec2 p = uv * AR;
        float col = floor(p.x / GRID);
        float row = floor(p.y / GRID);
        return vec3(
          (p.x - col * GRID) / GRID,
          (p.y - row * GRID) / GRID,
          (row * SPR + col) / (GRID - 1.0)
        );
      }
    `;

    // ── Quad rendering helpers ──
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    const quadScene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadVertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `;

    function makePass(fragmentShader: string, uniforms: any) {
      return new THREE.Mesh(
        quadGeometry,
        new THREE.ShaderMaterial({
          vertexShader: quadVertexShader,
          fragmentShader,
          uniforms,
          depthTest: false,
          depthWrite: false,
        }),
      );
    }

    function runPass(mesh: THREE.Mesh, target: THREE.WebGLRenderTarget | null) {
      quadScene.children.length = 0;
      quadScene.add(mesh);
      renderer.setRenderTarget(target);
      renderer.render(quadScene, quadCamera);
      renderer.setRenderTarget(null);
    }

    const fragHeader = `precision highp float;\nvarying vec2 vUv;\n`;

    // ── Advection ──
    const advectionFS = `${fragHeader}
      uniform sampler2D uVelocity, uSource;
      uniform float uDt, uDissipation;
      ${GLSL_ATLAS}
      void main() {
        vec3 uvw = toUVW(vUv);
        vec3 vel = sample3D(uVelocity, uvw).xyz;
        gl_FragColor = sample3D(uSource, uvw - uDt * vel) * uDissipation;
      }
    `;

    // ── Divergence ──
    const divergenceFS = `${fragHeader}
      uniform sampler2D uVelocity;
      ${GLSL_ATLAS}
      void main() {
        vec3 uvw = toUVW(vUv);
        float h = 1.0 / GRID;
        float div = 0.5 * (
          sample3D(uVelocity, uvw + vec3(h, 0, 0)).x - sample3D(uVelocity, uvw - vec3(h, 0, 0)).x +
          sample3D(uVelocity, uvw + vec3(0, h, 0)).y - sample3D(uVelocity, uvw - vec3(0, h, 0)).y +
          sample3D(uVelocity, uvw + vec3(0, 0, h)).z - sample3D(uVelocity, uvw - vec3(0, 0, h)).z
        );
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `;

    // ── Pressure solve ──
    const pressureFS = `${fragHeader}
      uniform sampler2D uPressure, uDivergence;
      ${GLSL_ATLAS}
      void main() {
        vec3 uvw = toUVW(vUv);
        float h = 1.0 / GRID;
        float neighbors =
          sample3D(uPressure, uvw + vec3(h, 0, 0)).x +
          sample3D(uPressure, uvw - vec3(h, 0, 0)).x +
          sample3D(uPressure, uvw + vec3(0, h, 0)).x +
          sample3D(uPressure, uvw - vec3(0, h, 0)).x +
          sample3D(uPressure, uvw + vec3(0, 0, h)).x +
          sample3D(uPressure, uvw - vec3(0, 0, h)).x;
        gl_FragColor = vec4((neighbors - sample3D(uDivergence, uvw).x) / 6.0, 0.0, 0.0, 1.0);
      }
    `;

    // ── Gradient subtraction ──
    const gradientFS = `${fragHeader}
      uniform sampler2D uPressure, uVelocity;
      ${GLSL_ATLAS}
      void main() {
        vec3 uvw = toUVW(vUv);
        float h = 1.0 / GRID;
        vec3 grad = 0.5 * vec3(
          sample3D(uPressure, uvw + vec3(h, 0, 0)).x - sample3D(uPressure, uvw - vec3(h, 0, 0)).x,
          sample3D(uPressure, uvw + vec3(0, h, 0)).x - sample3D(uPressure, uvw - vec3(0, h, 0)).x,
          sample3D(uPressure, uvw + vec3(0, 0, h)).x - sample3D(uPressure, uvw - vec3(0, 0, h)).x
        );
        gl_FragColor = vec4(sample3D(uVelocity, uvw).xyz - grad, 1.0);
      }
    `;

    // ── Forces: buoyancy pushes DOWN (exhaust), turbulence, swirl, mouse ──
    const forcesFS = `${fragHeader}
      uniform sampler2D uVelocity, uDensity, uTemperature;
      uniform float uDt, uTime, uRadius, uBuoyancy, uTurbulence, uSwirl;
      uniform vec3 uEmitPos;
      uniform vec3 uMouseForce;
      uniform vec3 uMousePos;
      uniform float uMouseActive;
      uniform float uMouseRadius;
      // Three nozzle positions
      uniform vec3 uNozzle0, uNozzle1, uNozzle2;
      ${GLSL_ATLAS}

      float hash(vec3 p) {
        p = fract(p * vec3(443.897, 441.423, 437.195));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }

      void main() {
        vec3 uvw = toUVW(vUv);
        vec3 vel = sample3D(uVelocity, uvw).xyz;
        float temp = sample3D(uTemperature, uvw).x;
        float dens = sample3D(uDensity, uvw).x;

        // Buoyancy: negative = exhaust pushes downward
        vel.y += (uBuoyancy * temp - dens * 0.3) * uDt;

        // Turbulence
        if (temp > 0.03) {
          float strength = uTurbulence * temp;
          vec3 noiseCoord = uvw * 7.0 + uTime * 2.5;
          vel.x += strength * (hash(noiseCoord) - 0.5) * uDt;
          vel.z += strength * (hash(noiseCoord + 100.0) - 0.5) * uDt;
          vel.y += strength * (hash(noiseCoord + 200.0) - 0.6) * uDt * 0.7;
        }

        // Swirl around each nozzle
        vec3 nozzles[3];
        nozzles[0] = uNozzle0;
        nozzles[1] = uNozzle1;
        nozzles[2] = uNozzle2;
        for (int n = 0; n < 3; n++) {
          float distToNozzle = length(uvw - nozzles[n]);
          if (distToNozzle < uRadius * 5.0) {
            vec3 worldPos = uvw - nozzles[n];
            float swirlStr = uSwirl * exp(-distToNozzle * 6.0);
            float angle = uTime * 3.0 + atan(worldPos.z, worldPos.x);
            vel.x += swirlStr * cos(angle + 1.57) * uDt;
            vel.z += swirlStr * sin(angle + 1.57) * uDt;
          }
        }

        // Mouse interaction
        if (uMouseActive > 0.5) {
          vec3 toMouse = uvw - uMousePos;
          float dist = length(toMouse);
          float radius = uMouseRadius;
          float influence = exp(-dist * dist / (radius * radius));
          vel += uMouseForce * influence * uDt * 12.0;
          if (dist > 0.001) {
            vec3 radialDir = normalize(toMouse);
            float radialStrength = length(uMouseForce) * influence * uDt * 6.0;
            vel += radialDir * radialStrength;
          }
        }

        // Boundary damping
        vec3 edgeFade = smoothstep(vec3(0.0), vec3(0.05), uvw) *
                        smoothstep(vec3(0.0), vec3(0.05), 1.0 - uvw);
        vel *= edgeFade.x * edgeFade.y * edgeFade.z;

        gl_FragColor = vec4(vel, 1.0);
      }
    `;

    // ── Multi-nozzle emitter ──
    const emitterFS = `${fragHeader}
      uniform sampler2D uSource;
      uniform float uDt, uTime, uRadius, uIsTemperature, uEmitDensity, uEmitTemperature;
      uniform vec3 uEmitPos;
      uniform vec3 uNozzle0, uNozzle1, uNozzle2;
      ${GLSL_ATLAS}
      void main() {
        vec3 uvw = toUVW(vUv);
        vec4 current = sample3D(uSource, uvw);

        float totalEmission = 0.0;
        vec3 nozzles[3];
        nozzles[0] = uNozzle0;
        nozzles[1] = uNozzle1;
        nozzles[2] = uNozzle2;

        for (int i = 0; i < 3; i++) {
          vec3 diff = uvw - nozzles[i];
          float emission = exp(-dot(diff, diff) / (uRadius * uRadius));
          // Pulsing per nozzle
          float phase = float(i) * 2.094;
          emission *= 0.75 + 0.25 * sin(uTime * 10.0 + phase) * sin(uTime * 15.0 + phase + 1.0);
          totalEmission += emission;
        }

        float strength = uIsTemperature > 0.5 ? uEmitTemperature : uEmitDensity;
        float maxVal = uIsTemperature > 0.5 ? 6.0 : 5.0;
        current.x = min(current.x + totalEmission * strength * uDt, maxVal);
        gl_FragColor = current;
      }
    `;

    // ── Volume ray-marching vertex shader ──
    const volumeVS = `
      varying vec3 vWorldPos, vOrigin;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vOrigin = cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `;

    // ── Volume ray-marching fragment shader — cinematic exhaust ──
    const volumeFS = `
      precision highp float;
      varying vec3 vWorldPos, vOrigin;
      uniform sampler2D uDensity, uTemperature;
      uniform vec3 uBoundsMin, uBoundsMax;
      uniform float uTime;
      uniform float uIsLightMode;
      ${GLSL_ATLAS}

      const int RAY_STEPS = ${quality.raySteps};
      const vec3 LIGHT_DIR = normalize(vec3(0.2, -0.8, 0.3));
      const vec3 LIGHT_COLOR = vec3(1.0, 0.92, 0.75);
      const vec3 AMBIENT_COLOR = vec3(0.12, 0.1, 0.08);

      vec2 intersectBox(vec3 origin, vec3 dir, vec3 bmin, vec3 bmax) {
        vec3 invDir = 1.0 / dir;
        vec3 t1 = (bmin - origin) * invDir;
        vec3 t2 = (bmax - origin) * invDir;
        vec3 tmin = min(t1, t2);
        vec3 tmax = max(t1, t2);
        return vec2(
          max(max(tmin.x, tmin.y), tmin.z),
          min(min(tmax.x, tmax.y), tmax.z)
        );
      }

      float hash13(vec3 p) {
        p = fract(p * vec3(0.1031, 0.11369, 0.13787));
        p += dot(p, p.zyx + 19.19);
        return fract((p.x + p.y) * p.z);
      }

      vec3 exhaustColor(float density, float temp, vec3 uvw, float shadow) {
        float turbulence = hash13(uvw * 18.0 + vec3(0.0, uTime * 0.25, uTime * 0.17));
        float flame = smoothstep(0.16, 1.15, temp) * smoothstep(0.025, 0.32, density);
        flame *= mix(0.86, 1.08, turbulence);
        float core = smoothstep(0.58, 1.85, temp) * smoothstep(0.06, 0.5, density);
        float smoke = smoothstep(0.01, 0.22, density) * (1.0 - smoothstep(0.26, 1.0, temp));
        smoke += smoothstep(0.14, 0.4, density) * smoothstep(0.05, 0.28, temp) * 0.35;
        smoke = clamp(smoke, 0.0, 1.0);

        vec3 smokeBase = mix(vec3(0.09, 0.10, 0.12), vec3(0.82, 0.80, 0.76), uIsLightMode);
        vec3 smokeWarm = mix(vec3(0.24, 0.22, 0.20), vec3(0.90, 0.82, 0.74), uIsLightMode);
        vec3 ember = mix(vec3(0.38, 0.09, 0.03), vec3(0.52, 0.17, 0.06), uIsLightMode);
        vec3 accentBorder = vec3(0.75, 0.46, 0.08);
        vec3 accentMain = mix(vec3(0.94, 0.72, 0.38), vec3(0.91, 0.66, 0.33), uIsLightMode);
        vec3 accentHover = mix(vec3(0.96, 0.78, 0.47), vec3(0.83, 0.54, 0.10), uIsLightMode);
        vec3 whiteHot = mix(vec3(1.0, 0.94, 0.82), vec3(0.98, 0.90, 0.72), uIsLightMode);

        vec3 smokeColor = mix(smokeBase, smokeWarm, smoothstep(0.02, 0.34, temp));
        smokeColor *= mix(0.6, 1.05, shadow);

        vec3 flameColor = mix(ember, accentBorder, smoothstep(0.12, 0.4, temp));
        flameColor = mix(flameColor, accentMain, smoothstep(0.28, 0.88, temp));
        flameColor = mix(flameColor, accentHover, smoothstep(0.72, 1.3, temp));
        flameColor = mix(flameColor, whiteHot, core * 0.72);
        flameColor *= mix(0.74, 1.02, shadow);

        return smokeColor * smoke + flameColor * flame;
      }

      void main() {
        vec3 rayDir = normalize(vWorldPos - vOrigin);
        vec2 t = intersectBox(vOrigin, rayDir, uBoundsMin, uBoundsMax);
        if (t.x > t.y) discard;
        t.x = max(t.x, 0.0);

        float stepSize = (t.y - t.x) / float(RAY_STEPS);
        vec3 pos = vOrigin + rayDir * t.x;
        vec3 step = rayDir * stepSize;
        vec4 accum = vec4(0.0);

        for (int i = 0; i < RAY_STEPS; i++) {
          vec3 uvw = (pos - uBoundsMin) / (uBoundsMax - uBoundsMin);

          if (all(greaterThan(uvw, vec3(0.001))) && all(lessThan(uvw, vec3(0.999)))) {
            float density = sample3D(uDensity, uvw).x;
            float temp = sample3D(uTemperature, uvw).x;

            if (density > 0.01) {
              float shadow = exp(-sample3D(uDensity, uvw + LIGHT_DIR / GRID * 2.0).x * 0.8);
              vec3 color = exhaustColor(density, temp, uvw, shadow);
              float flame = smoothstep(0.16, 1.15, temp) * smoothstep(0.025, 0.32, density);
              float core = smoothstep(0.58, 1.85, temp) * smoothstep(0.06, 0.5, density);
              float smoke = smoothstep(0.01, 0.22, density) * (1.0 - smoothstep(0.26, 1.0, temp));
              vec3 litColor = mix(
                color * (AMBIENT_COLOR + LIGHT_COLOR * shadow * 0.55),
                color,
                clamp(flame + core, 0.0, 1.0)
              );

              float smokeAlpha = smoke * density * stepSize * mix(6.2, 3.1, uIsLightMode);
              float flameAlpha = flame * density * stepSize * 15.0;
              float coreAlpha = core * density * stepSize * 6.0;
              float alpha = clamp(smokeAlpha + flameAlpha + coreAlpha, 0.0, 1.0) * (1.0 - accum.a);
              accum.rgb += litColor * alpha;
              accum.a += alpha;
              if (accum.a > 0.98) break;
            }
          }
          pos += step;
        }

        // Output with transparency (no solid background)
        vec3 finalColor = accum.rgb;
        finalColor = 1.0 - exp(-finalColor * mix(1.35, 1.05, uIsLightMode));
        finalColor = pow(finalColor, vec3(mix(0.92, 0.98, uIsLightMode)));

        // Use the accum.a for real transparency instead of drawing a bg box
        gl_FragColor = vec4(finalColor, accum.a);
      }
    `;

    // ── Simulation render targets ──
    let [velA, velB, denA, denB, tmpA, tmpB, presA, presB, divTarget] = Array(9)
      .fill(0)
      .map(createRenderTarget);

    const uni = (v: any) => ({ value: v ?? null });

    // Three nozzle positions in UVW space (top of volume, triangular arrangement)
    const nozzleSpacing = 0.12;
    const nozzleY = 0.88;
    const nozzle0 = new THREE.Vector3(0.5, nozzleY, 0.5 - nozzleSpacing);
    const nozzle1 = new THREE.Vector3(
      0.5 - nozzleSpacing * 0.866,
      nozzleY,
      0.5 + nozzleSpacing * 0.5,
    );
    const nozzle2 = new THREE.Vector3(
      0.5 + nozzleSpacing * 0.866,
      nozzleY,
      0.5 + nozzleSpacing * 0.5,
    );

    const emitPosition = new THREE.Vector3(0.5, 0.88, 0.5);

    // ── Simulation passes ──
    const advectVelocity = makePass(advectionFS, {
      uVelocity: uni(null),
      uSource: uni(null),
      uDt: uni(0.016),
      uDissipation: uni(0.995),
    });
    const advectDensity = makePass(advectionFS, {
      uVelocity: uni(null),
      uSource: uni(null),
      uDt: uni(0.016),
      uDissipation: uni(0.985),
    });
    const advectTemperature = makePass(advectionFS, {
      uVelocity: uni(null),
      uSource: uni(null),
      uDt: uni(0.016),
      uDissipation: uni(0.975),
    });
    const divergencePass = makePass(divergenceFS, { uVelocity: uni(null) });
    const pressurePass = makePass(pressureFS, {
      uPressure: uni(null),
      uDivergence: uni(null),
    });
    const gradientPass = makePass(gradientFS, {
      uPressure: uni(null),
      uVelocity: uni(null),
    });
    const forcesPass = makePass(forcesFS, {
      uVelocity: uni(null),
      uDensity: uni(null),
      uTemperature: uni(null),
      uDt: uni(0.016),
      uTime: uni(0),
      uEmitPos: uni(emitPosition.clone()),
      uRadius: uni(0.06),
      uBuoyancy: uni(4),
      uTurbulence: uni(0.8),
      uSwirl: uni(0.3),
      uMouseForce: uni(new THREE.Vector3()),
      uMouseActive: uni(0),
      uMousePos: uni(new THREE.Vector3(0.5, 0.5, 0.5)),
      uMouseRadius: uni(0.12),
      uNozzle0: uni(nozzle0.clone()),
      uNozzle1: uni(nozzle1.clone()),
      uNozzle2: uni(nozzle2.clone()),
    });
    const emitDensityPass = makePass(emitterFS, {
      uSource: uni(null),
      uDt: uni(0.016),
      uTime: uni(0),
      uEmitPos: uni(emitPosition.clone()),
      uRadius: uni(0.06),
      uIsTemperature: uni(0),
      uEmitDensity: uni(2.5),
      uEmitTemperature: uni(3.5),
      uNozzle0: uni(nozzle0.clone()),
      uNozzle1: uni(nozzle1.clone()),
      uNozzle2: uni(nozzle2.clone()),
    });
    const emitTemperaturePass = makePass(emitterFS, {
      uSource: uni(null),
      uDt: uni(0.016),
      uTime: uni(0),
      uEmitPos: uni(emitPosition.clone()),
      uRadius: uni(0.055),
      uIsTemperature: uni(1),
      uEmitDensity: uni(2.5),
      uEmitTemperature: uni(3.5),
      uNozzle0: uni(nozzle0.clone()),
      uNozzle1: uni(nozzle1.clone()),
      uNozzle2: uni(nozzle2.clone()),
    });

    // ── 3D scene ──
    const scene = new THREE.Scene();
    const boundsMin = new THREE.Vector3(-1.0, -1.2, -1.0);
    const boundsMax = new THREE.Vector3(1.0, 1.4, 1.0);

    const volumeMaterial = new THREE.ShaderMaterial({
      vertexShader: volumeVS,
      fragmentShader: volumeFS,
      uniforms: {
        uDensity: uni(null),
        uTemperature: uni(null),
        uBoundsMin: uni(boundsMin),
        uBoundsMax: uni(boundsMax),
        uTime: uni(0),
        uIsLightMode: uni(0),
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });

    const volumeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 2.6, 2.0),
      volumeMaterial,
    );
    volumeMesh.name = "volumeMesh";
    volumeMesh.position.set(0, 0.1, 0);
    scene.add(volumeMesh);

    // ── Build rocket base geometry (viewed from below) ──
    const rocketGroup = new THREE.Group();
    rocketGroup.name = "rocketGroup";
    const shellMaterials: THREE.MeshStandardMaterial[] = [];
    const trimMaterials: THREE.MeshStandardMaterial[] = [];
    const supportMaterials: THREE.MeshStandardMaterial[] = [];
    const glowMaterials: THREE.MeshStandardMaterial[] = [];

    // Main rocket body (cylindrical hull above)
    const bodyGeo = new THREE.CylinderGeometry(
      0.52,
      0.55,
      1.2,
      quality.bodySegments,
    );
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x222222, // bg-elevated #222222
      metalness: 0.6,
      roughness: 0.6,
    });
    shellMaterials.push(bodyMat);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.name = "rocketBody";
    bodyMesh.position.set(0, 2.0, 0);
    rocketGroup.add(bodyMesh);

    // Thrust plate / heat shield at the base
    const plateGeo = new THREE.CylinderGeometry(
      0.6,
      0.62,
      0.08,
      quality.bodySegments,
    );
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x333333, // border #333333
      metalness: 0.7,
      roughness: 0.4,
    });
    shellMaterials.push(plateMat);
    const plateMesh = new THREE.Mesh(plateGeo, plateMat);
    plateMesh.name = "thrustPlate";
    plateMesh.position.set(0, 1.38, 0);
    rocketGroup.add(plateMesh);

    // Engine nozzle builder
    function createNozzle(position: THREE.Vector3, index: number) {
      const nozzleGroup = new THREE.Group();
      nozzleGroup.name = `nozzleGroup${index}`;

      // Main bell (cone)
      const bellGeo = new THREE.CylinderGeometry(
        0.06,
        0.18,
        0.55,
        quality.nozzleSegments,
        1,
        true,
      );
      const bellMat = new THREE.MeshStandardMaterial({
        color: 0x444444, // border-strong #444444
        metalness: 0.8,
        roughness: 0.35,
        side: THREE.DoubleSide,
      });
      shellMaterials.push(bellMat);
      const bell = new THREE.Mesh(bellGeo, bellMat);
      bell.name = `nozzleBell${index}`;
      bell.position.y = -0.25;
      nozzleGroup.add(bell);

      // Inner bell (glowing)
      const innerGeo = new THREE.CylinderGeometry(
        0.04,
        0.16,
        0.5,
        quality.nozzleSegments,
        1,
        true,
      );
      const innerMat = new THREE.MeshStandardMaterial({
        color: 0xc07515, // accent-border #c07515
        metalness: 0.4,
        roughness: 0.8,
        side: THREE.BackSide,
        emissive: 0x3d3020, // accent-light #3d3020
        emissiveIntensity: 0.5,
      });
      glowMaterials.push(innerMat);
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.name = `nozzleInner${index}`;
      inner.position.y = -0.24;
      nozzleGroup.add(inner);

      // Ribbed rings on the bell
      for (let r = 0; r < 6; r++) {
        const t = r / 5;
        const radius = 0.065 + t * 0.115;
        const ringGeo = new THREE.TorusGeometry(
          radius,
          0.006,
          6,
          quality.ringSegments,
        );
        const ringMat = new THREE.MeshStandardMaterial({
          color: 0x8a8888, // text-dim #8a8888
          metalness: 0.85,
          roughness: 0.25,
        });
        trimMaterials.push(ringMat);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.name = `nozzleRing${index}_${r}`;
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -0.02 - t * 0.46;
        nozzleGroup.add(ring);
      }

      // Hydraulic lines (pipes running down the nozzle)
      for (let p = 0; p < 4; p++) {
        const angle = (p / 4) * Math.PI * 2 + Math.PI / 8;
        const pipePoints = [];
        for (let s = 0; s <= 10; s++) {
          const st = s / 10;
          const pr = 0.07 + st * 0.12;
          pipePoints.push(
            new THREE.Vector3(
              Math.cos(angle) * pr,
              -st * 0.5,
              Math.sin(angle) * pr,
            ),
          );
        }
        const pipeCurve = new THREE.CatmullRomCurve3(pipePoints);
        const pipeGeo = new THREE.TubeGeometry(
          pipeCurve,
          quality.pipeSegments,
          0.004,
          5,
          false,
        );
        const pipeMat = new THREE.MeshStandardMaterial({
          color: 0x3a3a3a, // border-muted #3a3a3a
          metalness: 0.8,
          roughness: 0.4,
        });
        supportMaterials.push(pipeMat);
        const pipe = new THREE.Mesh(pipeGeo, pipeMat);
        pipe.name = `nozzlePipe${index}_${p}`;
        nozzleGroup.add(pipe);
      }

      // Mechanical fixtures / mounting bolts
      for (let b = 0; b < 6; b++) {
        const bAngle = (b / 6) * Math.PI * 2;
        const boltGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.02, 6);
        const boltMat = new THREE.MeshStandardMaterial({
          color: 0x808080, // text-muted #808080
          metalness: 0.9,
          roughness: 0.3,
        });
        trimMaterials.push(boltMat);
        const bolt = new THREE.Mesh(boltGeo, boltMat);
        bolt.name = `nozzleBolt${index}_${b}`;
        bolt.position.set(
          Math.cos(bAngle) * 0.065,
          0.0,
          Math.sin(bAngle) * 0.065,
        );
        nozzleGroup.add(bolt);
      }

      // Cooling channel wrap (helix)
      const helixPoints = [];
      for (let h = 0; h <= 60; h++) {
        const ht = h / 60;
        const hAngle = ht * Math.PI * 8;
        const hr = 0.07 + ht * 0.115;
        helixPoints.push(
          new THREE.Vector3(
            Math.cos(hAngle) * (hr + 0.01),
            -ht * 0.48 - 0.02,
            Math.sin(hAngle) * (hr + 0.01),
          ),
        );
      }
      const helixCurve = new THREE.CatmullRomCurve3(helixPoints);
      const helixGeo = new THREE.TubeGeometry(
        helixCurve,
        quality.helixSegments,
        0.0025,
        4,
        false,
      );
      const helixMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, // border-light #2a2a2a
        metalness: 0.7,
        roughness: 0.4,
      });
      supportMaterials.push(helixMat);
      const helix = new THREE.Mesh(helixGeo, helixMat);
      helix.name = `nozzleHelix${index}`;
      nozzleGroup.add(helix);

      nozzleGroup.position.copy(position);
      return nozzleGroup;
    }

    // Position nozzles in triangular pattern
    const nozzleWorldSpacing = 0.3;
    const nozzlePositions = [
      new THREE.Vector3(0, 1.34, -nozzleWorldSpacing),
      new THREE.Vector3(
        -nozzleWorldSpacing * 0.866,
        1.34,
        nozzleWorldSpacing * 0.5,
      ),
      new THREE.Vector3(
        nozzleWorldSpacing * 0.866,
        1.34,
        nozzleWorldSpacing * 0.5,
      ),
    ];

    const nozzleLights: THREE.PointLight[] = [];

    nozzlePositions.forEach((pos, i) => {
      rocketGroup.add(createNozzle(pos, i));
    });

    // Cross-bracing struts between nozzles
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const mid = new THREE.Vector3().lerpVectors(
        nozzlePositions[i],
        nozzlePositions[j],
        0.5,
      );
      const dir = new THREE.Vector3().subVectors(
        nozzlePositions[j],
        nozzlePositions[i],
      );
      const len = dir.length();
      const strutGeo = new THREE.CylinderGeometry(0.006, 0.006, len, 6);
      const strutMat = new THREE.MeshStandardMaterial({
        color: 0x444444, // border-strong #444444
        metalness: 0.8,
        roughness: 0.4,
      });
      supportMaterials.push(strutMat);
      const strut = new THREE.Mesh(strutGeo, strutMat);
      strut.name = `strut${i}`;
      strut.position.copy(mid);
      strut.position.y -= 0.15;
      strut.lookAt(nozzlePositions[j].x, mid.y - 0.15, nozzlePositions[j].z);
      strut.rotateX(Math.PI / 2);
      rocketGroup.add(strut);
    }

    scene.add(rocketGroup);

    // ── Lighting ──
    const ambientLight = new THREE.AmbientLight(0x222222, 0.8);
    ambientLight.name = "ambientLight";
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xf5c878, 1.2); // accent-hover #f5c878
    dirLight.name = "dirLight";
    dirLight.position.set(2, 4, 3);
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x3dc88a, 0.4); // secondary #3dc88a
    rimLight.name = "rimLight";
    rimLight.position.set(-3, -2, -1);
    scene.add(rimLight);

    // Point lights near nozzles for glow effect
    nozzlePositions.forEach((pos, i) => {
      const pl = new THREE.PointLight(0xf0b860, 2.5, 2.0, 2); // accent #f0b860
      pl.name = `nozzleLight${i}`;
      pl.position.set(pos.x, pos.y - 0.4, pos.z);
      nozzleLights.push(pl);
      scene.add(pl);
    });

    function applyMaterialTheme(
      materials: THREE.MeshStandardMaterial[],
      color: number,
      metalness: number,
      roughness: number,
    ) {
      materials.forEach((material) => {
        material.color.setHex(color);
        material.metalness = metalness;
        material.roughness = roughness;
      });
    }

    // ── Theme Observer ──
    const updateTheme = () => {
      if (typeof document !== "undefined") {
        const isLight = document.documentElement.classList.contains("light");
        const isDark = document.documentElement.classList.contains("dark");

        if (isLight) {
          isLightMode = true;
        } else if (isDark) {
          isLightMode = false;
        } else {
          isLightMode = !window.matchMedia("(prefers-color-scheme: dark)")
            .matches;
        }

        // Update uniforms
        if (volumeMaterial)
          volumeMaterial.uniforms.uIsLightMode.value = isLightMode ? 1.0 : 0.0;

        if (isLightMode) {
          applyMaterialTheme(shellMaterials, 0x625d58, 0.16, 0.84);
          applyMaterialTheme(trimMaterials, 0x948b82, 0.16, 0.76);
          applyMaterialTheme(supportMaterials, 0x756d65, 0.12, 0.86);
          glowMaterials.forEach((material) => {
            material.color.setHex(0xd7ae73);
            material.emissive.setHex(0x6b421b);
            material.emissiveIntensity = 0.58;
            material.metalness = 0.1;
            material.roughness = 0.76;
          });

          ambientLight.color.setHex(0xc7c0b4);
          ambientLight.intensity = 0.42;
          dirLight.color.setHex(0xf1ece3);
          dirLight.intensity = 0.92;
          rimLight.color.setHex(0xcbbba4);
          rimLight.intensity = 0.08;
          nozzleLights.forEach((light) => {
            light.color.setHex(0xf0b860);
            light.intensity = 1.45;
          });
        } else {
          applyMaterialTheme(shellMaterials, 0x35302b, 0.52, 0.56);
          applyMaterialTheme(trimMaterials, 0x847c74, 0.58, 0.34);
          applyMaterialTheme(supportMaterials, 0x49423c, 0.5, 0.48);
          glowMaterials.forEach((material) => {
            material.color.setHex(0xc07515);
            material.emissive.setHex(0x3d3020);
            material.emissiveIntensity = 0.5;
            material.metalness = 0.4;
            material.roughness = 0.8;
          });

          ambientLight.color.setHex(0x222222);
          ambientLight.intensity = 0.8;
          dirLight.color.setHex(0xf5c878);
          dirLight.intensity = 1.2;
          rimLight.color.setHex(0x3dc88a);
          rimLight.intensity = 0.4;
          nozzleLights.forEach((light) => {
            light.color.setHex(0xf0b860);
            light.intensity = 2.5;
          });
        }
      }
    };

    // Initial theme check
    updateTheme();

    if (typeof document !== "undefined") {
      themeObserver = new MutationObserver(updateTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      colorSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      handleThemeChange = updateTheme;
      colorSchemeMediaQuery.addEventListener("change", handleThemeChange);
    }

    // ── Post-processing: subtle cinematic composite ──
    const composer = new EffectComposer(renderer);
    // composer should render to transparent background
    const renderPass = new RenderPass(scene, camera);
    renderPass.clearColor = new THREE.Color(0x000000);
    renderPass.clearAlpha = 0;
    composer.addPass(renderPass);

    const compositeShader = {
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(scaledWidth, scaledHeight) },
        uIsLightMode: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec2 uResolution;
        uniform float uIsLightMode;

        float hash21(vec2 p) {
          p = fract(p * vec2(443.897, 441.423));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y);
        }

        vec2 heatShimmer(vec2 uv, float time) {
          float strength = smoothstep(0.25, 0.95, uv.y) * 0.0025;
          float shimX = sin(uv.y * 48.0 + time * 3.6) * strength;
          float shimY = cos(uv.x * 36.0 + time * 2.8) * strength * 0.4;
          return vec2(shimX, shimY);
        }

        void main() {
          vec2 uv = vUv;
          vec2 shimmer = heatShimmer(uv, uTime);
          vec2 distortedUv = uv + shimmer;
          vec4 color = texture2D(tDiffuse, distortedUv);
          if (color.a < 0.01) {
            gl_FragColor = vec4(0.0);
            return;
          }

          vec2 texel = 1.0 / uResolution;
          vec3 blur = texture2D(tDiffuse, distortedUv + vec2(texel.x * 2.0, 0.0)).rgb;
          blur += texture2D(tDiffuse, distortedUv - vec2(texel.x * 2.0, 0.0)).rgb;
          blur += texture2D(tDiffuse, distortedUv + vec2(0.0, texel.y * 2.0)).rgb;
          blur += texture2D(tDiffuse, distortedUv - vec2(0.0, texel.y * 2.0)).rgb;
          blur *= 0.25;

          float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          float flameMask = smoothstep(0.18, 0.92, lum);
          float smokeMask = smoothstep(0.03, 0.28, lum) * (1.0 - flameMask);
          vec3 emberGlow = mix(vec3(0.94, 0.72, 0.38), vec3(0.91, 0.66, 0.33), uIsLightMode);
          vec3 smokeTint = mix(vec3(0.16, 0.18, 0.21), vec3(0.84, 0.82, 0.78), uIsLightMode);
          vec3 glow = max(blur - color.rgb * 0.45, 0.0);

          vec3 finalColor = color.rgb;
          finalColor = mix(finalColor, smokeTint, smokeMask * mix(0.08, 0.14, uIsLightMode));
          finalColor += glow * emberGlow * (0.18 + flameMask * 0.42);
          finalColor += flameMask * color.rgb * mix(0.08, 0.05, uIsLightMode);

          float vignette = smoothstep(1.2, 0.2, length((uv - 0.5) * vec2(1.1, 1.6)));
          finalColor *= mix(0.92, 1.0, vignette);

          float grain = hash21(uv * uResolution * 0.35 + uTime * 0.07) * 0.02 - 0.01;
          finalColor += grain;

          float outAlpha = color.a;
          if (uIsLightMode > 0.5) {
            outAlpha *= mix(0.38, 1.0, flameMask);
          }

          finalColor = 1.0 - exp(-finalColor * mix(1.08, 0.98, uIsLightMode));
          gl_FragColor = vec4(finalColor, outAlpha);
        }
      `,
    };

    const compositePass = new ShaderPass(compositeShader);
    composer.addPass(compositePass);

    // ── Helper functions ──
    function setUniforms(mesh: THREE.Mesh, values: any) {
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      for (const key in values) {
        const val = values[key];
        const current = u[key].value;
        if (current instanceof THREE.Vector3 && val instanceof THREE.Vector3) {
          current.copy(val);
          continue;
        }
        u[key].value = val;
      }
    }

    const currentEmitPos = new THREE.Vector3();
    const mouseForce3D = new THREE.Vector3();
    const prevMouseWorld = new THREE.Vector3(0.5, 0.5, 0.5);
    const mouseVelocity3D = new THREE.Vector3();
    const dynamicNozzle0 = nozzle0.clone();
    const dynamicNozzle1 = nozzle1.clone();
    const dynamicNozzle2 = nozzle2.clone();
    const rayDirection = new THREE.Vector3();
    const planeNormal = new THREE.Vector3();
    const hitPoint = new THREE.Vector3();
    const firePlane = new THREE.Plane();
    const uvwMin = new THREE.Vector3(0, 0, 0);
    const uvwMax = new THREE.Vector3(1, 1, 1);

    function updateMouseWorldPosition() {
      raycaster.setFromCamera(mouse, camera);
      camera.getWorldDirection(rayDirection);
      planeNormal.set(
        -rayDirection.x,
        0,
        -rayDirection.z,
      ).normalize();
      if (planeNormal.length() < 0.001) planeNormal.set(0, 0, 1);
      firePlane.set(planeNormal, 0);
      if (raycaster.ray.intersectPlane(firePlane, hitPoint)) {
        mouseWorld3D.set(
          (hitPoint.x - boundsMin.x) / (boundsMax.x - boundsMin.x),
          (hitPoint.y - boundsMin.y) / (boundsMax.y - boundsMin.y),
          (hitPoint.z - boundsMin.z) / (boundsMax.z - boundsMin.z),
        );
        mouseWorld3D.clamp(uvwMin, uvwMax);
      }
    }

    // ── Main simulation step ──
    function simulate(dt: number, time: number) {
      const simDt = Math.min(dt, 0.033) * params.simSpeed;

      currentEmitPos.set(
        0.5 + Math.sin(time * 0.5) * 0.01,
        0.88,
        0.5 + Math.cos(time * 0.7) * 0.01,
      );

      // Wobble nozzle positions slightly
      const wobble = 0.005;
      dynamicNozzle0.copy(nozzle0);
      dynamicNozzle1.copy(nozzle1);
      dynamicNozzle2.copy(nozzle2);
      dynamicNozzle0.x += Math.sin(time * 3.0) * wobble;
      dynamicNozzle1.x += Math.sin(time * 3.2 + 2.0) * wobble;
      dynamicNozzle2.x += Math.sin(time * 2.8 + 4.0) * wobble;

      if (mouseActive) {
        updateMouseWorldPosition();
        mouseVelocity3D
          .copy(mouseWorld3D)
          .sub(prevMouseWorld)
          .multiplyScalar(1.0 / Math.max(dt, 0.001));
        mouseVelocity3D.clampLength(0, 30.0);
        mouseForce3D.copy(mouseVelocity3D);
        prevMouseWorld.copy(mouseWorld3D);
      } else {
        mouseForce3D.multiplyScalar(0.9);
      }

      // 1. Advect velocity
      setUniforms(advectVelocity, {
        uVelocity: velA.texture,
        uSource: velA.texture,
        uDt: simDt,
        uDissipation: params.velocityDissipation,
      });
      runPass(advectVelocity, velB);
      [velA, velB] = [velB, velA];

      // 2. Apply forces
      setUniforms(forcesPass, {
        uVelocity: velA.texture,
        uDensity: denA.texture,
        uTemperature: tmpA.texture,
        uDt: simDt,
        uTime: time,
        uEmitPos: currentEmitPos,
        uRadius: params.emitRadius,
        uBuoyancy: params.buoyancy,
        uTurbulence: params.turbulence,
        uSwirl: params.swirl,
        uMouseForce: mouseForce3D,
        uMouseActive: mouseActive ? 1.0 : 0.0,
        uMousePos: mouseWorld3D,
        uMouseRadius: 0.12,
        uNozzle0: dynamicNozzle0,
        uNozzle1: dynamicNozzle1,
        uNozzle2: dynamicNozzle2,
      });
      runPass(forcesPass, velB);
      [velA, velB] = [velB, velA];

      // 3. Pressure projection
      (
        divergencePass.material as THREE.ShaderMaterial
      ).uniforms.uVelocity.value = velA.texture;
      runPass(divergencePass, divTarget);

      renderer.setRenderTarget(presA);
      renderer.clear();
      renderer.setRenderTarget(null);

      for (let i = 0; i < params.pressureIterations; i++) {
        setUniforms(pressurePass, {
          uPressure: presA.texture,
          uDivergence: divTarget.texture,
        });
        runPass(pressurePass, presB);
        [presA, presB] = [presB, presA];
      }

      setUniforms(gradientPass, {
        uPressure: presA.texture,
        uVelocity: velA.texture,
      });
      runPass(gradientPass, velB);
      [velA, velB] = [velB, velA];

      // 4. Advect density and temperature
      setUniforms(advectDensity, {
        uVelocity: velA.texture,
        uSource: denA.texture,
        uDt: simDt,
        uDissipation: params.densityDissipation,
      });
      runPass(advectDensity, denB);
      [denA, denB] = [denB, denA];

      setUniforms(advectTemperature, {
        uVelocity: velA.texture,
        uSource: tmpA.texture,
        uDt: simDt,
        uDissipation: params.temperatureDissipation,
      });
      runPass(advectTemperature, tmpB);
      [tmpA, tmpB] = [tmpB, tmpA];

      // 5. Emit from all three nozzles
      setUniforms(emitDensityPass, {
        uSource: denA.texture,
        uDt: simDt,
        uTime: time,
        uEmitPos: currentEmitPos,
        uRadius: params.emitRadius,
        uEmitDensity: params.emitDensity,
        uEmitTemperature: params.emitTemperature,
        uNozzle0: dynamicNozzle0,
        uNozzle1: dynamicNozzle1,
        uNozzle2: dynamicNozzle2,
      });
      runPass(emitDensityPass, denB);
      [denA, denB] = [denB, denA];

      setUniforms(emitTemperaturePass, {
        uSource: tmpA.texture,
        uDt: simDt,
        uTime: time,
        uEmitPos: currentEmitPos,
        uRadius: params.emitRadius * 0.92,
        uEmitDensity: params.emitDensity,
        uEmitTemperature: params.emitTemperature,
        uNozzle0: dynamicNozzle0,
        uNozzle1: dynamicNozzle1,
        uNozzle2: dynamicNozzle2,
      });
      runPass(emitTemperaturePass, tmpB);
      [tmpA, tmpB] = [tmpB, tmpA];
    }

    // ── Animation loop ──
    function animate(timestamp: number) {
      if (isDestroyed || !shouldAnimate) {
        animationFrameId = undefined;
        return;
      }
      animationFrameId = requestAnimationFrame(animate);
      const frameInterval = 1000 / quality.targetFps;
      if (lastFrameTime !== 0 && timestamp - lastFrameTime < frameInterval) {
        return;
      }
      const dt =
        lastFrameTime === 0 ? 1 / quality.targetFps : (timestamp - lastFrameTime) / 1000;
      lastFrameTime = timestamp;
      elapsedTime += Math.min(dt, 0.05);
      const time = elapsedTime;

      simulate(dt, time);

      volumeMaterial.uniforms.uDensity.value = denA.texture;
      volumeMaterial.uniforms.uTemperature.value = tmpA.texture;
      volumeMaterial.uniforms.uTime.value = time;

      // Flicker nozzle lights
      nozzleLights.forEach((light) => {
        light.intensity = 2.5 + Math.sin(time * 12 + light.position.x * 10) * 0.8;
      });

      // Update composite shader uniforms
      const passMat = compositePass.material as THREE.ShaderMaterial;
      if (passMat && passMat.uniforms.uTime) {
        passMat.uniforms.uTime.value = time;
        passMat.uniforms.uIsLightMode.value = isLightMode ? 1.0 : 0.0;
      }

      composer.render();
    }
    syncAnimation = () => {
      const nextShouldAnimate =
        isInitialized && isVisible && isDocumentVisible && !isDestroyed;
      if (nextShouldAnimate === shouldAnimate) return;
      shouldAnimate = nextShouldAnimate;

      if (!shouldAnimate) {
        if (animationFrameId !== undefined) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = undefined;
        }
        lastFrameTime = 0;
        return;
      }

      if (animationFrameId === undefined) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    handleResize = () => {
      if (!container || isDestroyed) return;
      const rect = container.getBoundingClientRect();
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      const renderWidth = Math.max(
        1,
        Math.round(rect.width * quality.renderScale),
      );
      const renderHeight = Math.max(
        1,
        Math.round(rect.height * quality.renderScale),
      );
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, quality.pixelRatioCap),
      );
      renderer.setSize(renderWidth, renderHeight, false);
      composer.setSize(renderWidth, renderHeight);
      const passMat = compositePass.material as THREE.ShaderMaterial;
      if (passMat && passMat.uniforms.uResolution) {
        passMat.uniforms.uResolution.value.set(renderWidth, renderHeight);
      }
    };

    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    handleResize();
    isInitialized = true;
    syncAnimation();
  }

  onMount(() => {
    if (!container) return;

    isDocumentVisible =
      typeof document === "undefined" || document.visibilityState === "visible";

    const maybeInitialize = () => {
      if (initializationPromise || isDestroyed) return;
      initializationPromise = initializeFlame().catch((error) => {
        isInitialized = false;
        initializationPromise = undefined;
        console.error("RocketFlame initialization failed", error);
      });
    };

    visibilityObserver = new IntersectionObserver(
      (entries) => {
        isVisible = entries.some((entry) => entry.isIntersecting);
        if (isVisible) {
          maybeInitialize();
        }
        syncAnimation();
      },
      { rootMargin: "320px 0px" },
    );
    visibilityObserver.observe(container);

    handleDocumentVisibility = () => {
      isDocumentVisible =
        typeof document === "undefined" || document.visibilityState === "visible";
      syncAnimation();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleDocumentVisibility);
    }
  });

  onDestroy(() => {
    isDestroyed = true;
    if (themeObserver) themeObserver.disconnect();
    if (visibilityObserver) visibilityObserver.disconnect();
    if (resizeObserver) resizeObserver.disconnect();

    if (typeof document !== "undefined" && handleDocumentVisibility) {
      document.removeEventListener("visibilitychange", handleDocumentVisibility);
    }
    if (colorSchemeMediaQuery && handleThemeChange) {
      colorSchemeMediaQuery.removeEventListener("change", handleThemeChange);
    }

    if (typeof window !== "undefined" && animationFrameId !== undefined) {
      cancelAnimationFrame(animationFrameId);
    }
    if (container) {
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      renderer?.domElement?.remove();
    }

    try {
      renderer?.dispose();
    } catch (e) {
      // ignore
    }
  });
</script>

<div
  bind:this={container}
  class="w-full h-full absolute inset-0 z-0 pointer-events-auto"
></div>
