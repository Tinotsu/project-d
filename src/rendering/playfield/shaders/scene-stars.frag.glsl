varying vec3 starDirection;

float random(vec2 point) {
  return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453);
}

float starLayer(vec2 coordinates, vec2 resolution, float threshold) {
  vec2 grid = coordinates * resolution;
  vec2 cell = floor(grid);
  vec2 point = fract(grid) - 0.5;
  float seed = random(cell);
  float radius = mix(0.04, 0.11, random(cell + 19.7));
  return step(threshold, seed) * (1.0 - smoothstep(radius, radius * 1.8, length(point)));
}

void main() {
  vec3 direction = normalize(starDirection);
  float horizon = pow(1.0 - abs(direction.y), 18.0);
  vec3 color = vec3(0.0002, 0.0005, 0.0015) + vec3(0.002, 0.018, 0.05) * horizon;

  vec2 coordinates = vec2(
    atan(direction.z, direction.x) / 6.28318530718 + 0.5,
    asin(clamp(direction.y, -1.0, 1.0)) / 3.14159265359 + 0.5
  );
  float smallStars = starLayer(coordinates, vec2(1100.0, 550.0), 0.94);
  float largeStars = starLayer(coordinates, vec2(650.0, 325.0), 0.994);
  color += vec3(smallStars * 0.8 + largeStars * 1.2);

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
