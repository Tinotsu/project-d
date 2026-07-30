uniform vec3 primaryColor;
uniform vec3 secondaryColor;
uniform vec3 edgeColor;
uniform vec3 centerColor;
uniform float time;
uniform vec3 hU;
uniform vec3 hV;
uniform vec3 hW;

#ifdef WARPED
varying vec2 logicalPosition;
#else
varying vec2 assetUv;
#endif

float roundedBoxDistance(vec2 point, vec2 halfSize, float radius) {
  vec2 edge = abs(point) - halfSize + radius;
  return min(max(edge.x, edge.y), 0.0)
    + length(max(edge, 0.0))
    - radius;
}

float ellipseMask(
  vec2 point,
  vec2 center,
  vec2 radius,
  float rotation
) {
  float cosine = cos(rotation);
  float sine = sin(rotation);
  vec2 offset = point - center;
  vec2 rotated = vec2(
    cosine * offset.x + sine * offset.y,
    -sine * offset.x + cosine * offset.y
  );
  return 1.0 - smoothstep(0.91, 1.0, length(rotated / radius));
}

float footprintMask(vec2 assetUv) {
  vec2 point = vec2(assetUv.x, 1.0 - assetUv.y);
  float mask = ellipseMask(point, vec2(0.275, 0.285), vec2(0.048, 0.06), -0.35);
  mask = max(mask, ellipseMask(point, vec2(0.375, 0.225), vec2(0.06, 0.07), -0.12));
  mask = max(mask, ellipseMask(point, vec2(0.485, 0.205), vec2(0.068, 0.078), 0.0));
  mask = max(mask, ellipseMask(point, vec2(0.62, 0.22), vec2(0.088, 0.1), 0.3));
  mask = max(mask, ellipseMask(point, vec2(0.43, 0.46), vec2(0.16, 0.19), 0.2));
  mask = max(mask, ellipseMask(point, vec2(0.43, 0.61), vec2(0.115, 0.2), -0.28));
  mask = max(mask, ellipseMask(point, vec2(0.51, 0.77), vec2(0.105, 0.13), -0.3));
  return mask;
}

float chevronBand(
  vec2 assetUv,
  float center,
  float halfWidth,
  float rows,
  float scroll
) {
  float horizontal = abs(assetUv.x - center) / halfWidth;
  float cell = fract((assetUv.y + scroll) * rows);
  float target = 0.78 - horizontal * 0.58;
  float distanceToLine = abs(cell - target);
  distanceToLine = min(distanceToLine, 1.0 - distanceToLine);
  float line = 1.0 - smoothstep(0.045, 0.09, distanceToLine);
  return line * (1.0 - smoothstep(0.92, 1.0, horizontal));
}

vec3 footBasePattern(vec2 assetUv) {
  float gradient = clamp(
    1.01 - assetUv.x * 1.9 - assetUv.y * 0.061,
    0.0,
    1.0
  );

  vec2 dotCell = fract(assetUv * vec2(60.6, 10.4)) - 0.5;
  float dotMask = 1.0 - smoothstep(0.27, 0.31, length(dotCell));

  vec3 color = mix(vec3(0.0), vec3(0.5725), gradient);
  return mix(color, vec3(0.976), dotMask * 0.05);
}

vec3 normalStepPattern(
  vec2 assetUv,
  float time,
  vec3 edgeColor,
  vec3 centerColor
) {
  float wave = 0.5 + 0.5 * cos((assetUv.y - time * 0.6) * 6.28318530718);
  wave = smoothstep(0.12, 0.88, wave);

  vec2 dotCell = fract(assetUv * vec2(10.0, 7.0)) - 0.5;
  float dotMask = 1.0 - smoothstep(0.16, 0.23, length(dotCell));

  vec3 color = mix(edgeColor, centerColor, wave);
  return mix(color, vec3(0.976), dotMask * 0.2);
}

void main() {
#ifdef WARPED
  vec3 point = vec3(logicalPosition, 1.0);
  float denominator = dot(hW, point);
  vec2 assetUv = vec2(dot(hU, point), dot(hV, point)) / denominator;
  if (assetUv.x < 0.0 || assetUv.x > 1.0 || assetUv.y < 0.0 || assetUv.y > 1.0) discard;
#endif

  vec4 assetColor = vec4(0.0);

#if ASSET_KIND == 0
  vec2 assetPoint = (assetUv - 0.5) * vec2(1.49, 1.0);
  float outerDistance = roundedBoxDistance(assetPoint, vec2(0.745, 0.5), 0.12);
  if (outerDistance > 0.0) discard;

  float innerDistance = roundedBoxDistance(assetPoint, vec2(0.72, 0.475), 0.095);
  vec3 color = innerDistance > 0.0
    ? vec3(0.947)
    : normalStepPattern(assetUv, time, edgeColor, centerColor);
  assetColor = vec4(color, 1.0);
#elif ASSET_KIND == 1
  vec2 assetPoint = (assetUv - 0.5) * vec2(5.826923, 1.0);
  float outerDistance = roundedBoxDistance(assetPoint, vec2(2.913462, 0.5), 0.067);
  if (outerDistance > 0.0) discard;

  float innerDistance = roundedBoxDistance(assetPoint, vec2(2.884615, 0.471154), 0.038);
  vec3 color = innerDistance > 0.0
    ? vec3(0.976)
    : footBasePattern(assetUv);
  assetColor = vec4(color, 1.0);
#elif ASSET_KIND == 2
  vec2 ringPoint = (assetUv - vec2(0.5, 0.519)) * vec2(1.0, 1.04);
  float ring = 1.0 - smoothstep(0.008, 0.018, abs(length(ringPoint) - 0.48));
  float footprint = footprintMask(assetUv);
  float topToBottom = 1.0 - assetUv.y;
  vec3 footprintColor = mix(vec3(0.98, 0.965, 0.0), vec3(0.961, 0.635, 0.114), topToBottom);
  vec3 ringColor = mix(vec3(0.961, 0.635, 0.114), vec3(0.98, 0.965, 0.0), topToBottom);
  float alpha = max(ring, footprint);
  if (alpha < 0.01) discard;
  assetColor = vec4(mix(ringColor, footprintColor, footprint), alpha);
#elif ASSET_KIND == 3
  float diamond = 1.0 - clamp(
    max(abs(assetUv.x - 0.5) * 1.5, abs(assetUv.y - 0.5) * 0.42),
    0.0,
    1.0
  );
  float alternatingLane = mod(floor(assetUv.x * 4.0), 2.0);
  vec3 color = mix(vec3(0.025, 0.075, 0.052), vec3(0.0, 0.27, 0.085), diamond * 0.38);
  color += vec3(0.025) * alternatingLane;

  float lanePosition = fract(assetUv.x * 4.0);
  float lineDistance = min(lanePosition, 1.0 - lanePosition);
  float laneLine = 1.0 - smoothstep(0.012, 0.025, lineDistance);
  color = mix(color, vec3(0.976), laneLine);
  assetColor = vec4(color, 1.0);
#elif ASSET_KIND == 4
  vec2 assetPoint = (assetUv - 0.5) * vec2(6.0, 1.0);
  float outerDistance = roundedBoxDistance(assetPoint, vec2(3.0, 0.5), 0.065);
  if (outerDistance > 0.0) discard;

  float innerDistance = roundedBoxDistance(assetPoint, vec2(2.95, 0.45), 0.04);
  float pulse = 0.5 + 0.5 * sin(-time * 12.56637061436);
  vec3 faceColor = mix(secondaryColor, primaryColor, 0.35 + pulse * 0.55);
  vec2 dotCell = fract(assetUv * vec2(60.0, 10.0)) - 0.5;
  float dots = 1.0 - smoothstep(0.27, 0.32, length(dotCell));
  faceColor = mix(faceColor, primaryColor, dots * 0.3);
  vec3 color = innerDistance > 0.0 ? vec3(0.976) : faceColor;
  assetColor = vec4(color, 1.0);
#elif ASSET_KIND == 5
  float scroll = -time * 0.32;
  float left = chevronBand(assetUv, 0.25, 0.095, 5.0, scroll);
  float right = chevronBand(assetUv, 0.75, 0.095, 5.0, scroll);
  float mask = max(left, right);
  float pulse = 0.55 + 0.35 * sin(-time * 10.0);
  if (mask < 0.01) discard;
  assetColor = vec4(primaryColor, mask * pulse);
#elif ASSET_KIND == 6
  float arrows = chevronBand(assetUv, 0.5, 0.52, 6.0, -time * 0.26);
  float edgeGlow = abs(assetUv.x - 0.5) * 2.0;
  vec3 color = mix(secondaryColor, primaryColor, edgeGlow * 0.24);
  color = mix(color, primaryColor, arrows * 0.82);
  assetColor = vec4(color, 0.96);
#elif ASSET_KIND == 7
  float edgeFade = smoothstep(0.0, 0.25, assetUv.x)
    * smoothstep(0.0, 0.25, 1.0 - assetUv.x);
  float stripeCell = abs(fract((assetUv.x - time * 0.07) * 30.0) - 0.5);
  float stripes = 1.0 - smoothstep(0.14, 0.23, stripeCell);
  vec3 color = mix(secondaryColor, primaryColor, stripes * 0.75);
  assetColor = vec4(color, edgeFade * (0.68 + stripes * 0.24));
#else
  float arrows = chevronBand(assetUv, 0.5, 0.52, 5.0, -time * 0.26);
  vec3 color = mix(primaryColor, secondaryColor, arrows * 0.94);
  assetColor = vec4(color, 0.96);
#endif

  gl_FragColor = assetColor;

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
