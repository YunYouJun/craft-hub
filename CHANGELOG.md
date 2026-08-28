# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/).

## [Unreleased]

### Added

- Cross-project registry with explicit trust state
- Discovery for package scripts, Makefile and Taskfile commands
- Project-local Agent, Claude, and Codex skill discovery
- Structured command execution with persisted run records
- CLI, local API, Vue workbench, and thin Electron host
- Optional, schema-validated `.craft-hub/project.jsonc` metadata

### Changed

- Project configuration now uses JSONC as its only canonical format, with Zod-derived runtime validation and JSON Schema

### Fixed

### Removed
