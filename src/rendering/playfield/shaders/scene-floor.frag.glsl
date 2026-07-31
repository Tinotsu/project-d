varying vec3 scenePosition;

void main() {
  vec2 trackUv = vec2(
    clamp((scenePosition.x + 2.0) / 4.0, 0.0, 1.0),
    clamp((scenePosition.z + 33.0) / 36.0, 0.0, 1.0)
  );
  float diamond = 1.0 - clamp(
    max(abs(trackUv.x - 0.5) * 1.5, abs(trackUv.y - 0.5) * 0.42),
    0.0,
    1.0
  );
  float alternatingLane = mod(floor(trackUv.x * 4.0), 2.0);
  vec3 color = mix(vec3(0.025, 0.075, 0.052), vec3(0.0, 0.27, 0.085), diamond * 0.38);
  color += vec3(0.025) * alternatingLane;
  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
