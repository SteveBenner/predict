# Changelog

## 2.2.2 · 2026-10-19

The polispec environments policy now declares a test deploy whose health check runs `node bin/predict version`, so a release can record that the tested commit runs and the stable promotion gate can pass. No behaviour of the validator, runtime or MCP server changed; only the version constant moves with the release.

## 2.2.1 · 2026-10-16

Initial clean MIT release of the current Predict 2 source. Vendoring preserves the MIT license and includes it in the integrity lock.
