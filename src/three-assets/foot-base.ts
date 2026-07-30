export const footBasePatternShader = `
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
`;
