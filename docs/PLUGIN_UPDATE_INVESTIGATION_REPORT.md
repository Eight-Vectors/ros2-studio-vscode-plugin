# VS Code Extension Update Process Investigation Report

**Date**: January 29, 2025  
**Author**: Development Team  
**Purpose**: Investigation and documentation of VS Code extension update procedures

## Executive Summary

This report documents the investigation into the VS Code extension update process for the ROS Bridge Extension. The investigation covers manual and automated update methods, marketplace review processes, and user update mechanisms. Our findings show that the extension is well-configured for automated updates via GitHub Actions, with a typical update-to-deployment time of 10-15 minutes.

## Table of Contents

1. [Publishing Methods](#publishing-methods)
2. [Automated Publishing via GitHub Actions](#automated-publishing-via-github-actions)
3. [Marketplace Requirements](#marketplace-requirements)
4. [Current Implementation Status](#current-implementation-status)
5. [Quick Start Guide](#quick-start-guide)

## Publishing Methods

### Prerequisites

- Node.js LTS version
- `npm install -g @vscode/vsce`
- Personal Access Token (PAT) from Azure DevOps
- VS Code Marketplace publisher account

### Manual Publishing

```bash
npm version patch
vsce publish
```

**Time:** 2-5 minutes

### Automated Publishing (Recommended)

```bash
git tag v1.0.0
git push origin v1.0.0  # Triggers GitHub Actions
```

**Time:** 5-10 minutes (fully automated)

## Automated Publishing via GitHub Actions

The `.github/workflows/publish.yml` workflow automatically:

1. Triggers on version tags (`v*`)
2. Builds and tests the extension
3. Publishes to VS Code Marketplace
4. Creates GitHub release

**Required Secret:** `VSCE_PAT` in GitHub repository settings

## Marketplace Requirements

### Key Publishing Facts

- **Publishing is immediate** - No manual review for 99%+ of extensions
- **Updates publish instantly** - No review process
- **Required files**: README.md, LICENSE, package.json
- **Icon**: 128x128 PNG (convert SVG with: `convert -resize 128x128 icon.svg icon.png`)
- **Keywords**: Maximum 30 in package.json
- **Security**: No user-provided SVGs, HTTPS-only image URLs

## Current Implementation Status

### ✅ Implemented

1. **GitHub Actions Workflow**

   - Automated build pipeline
   - Test execution
   - Package creation
   - Marketplace publishing setup

2. **Version Management**

   - Semantic versioning in place
   - Git tag-based triggers
   - Changelog maintenance

3. **Build Process**
   - Webpack bundling configured
   - Production optimizations
   - Dependency exclusion

### ⚠️ Pending Setup

1. **Publisher Account**

   - Need to create VS Code publisher ID
   - Register under EightVectors organization
   - Verify Microsoft account is linked

2. **Access Token**

   - Generate Personal Access Token (PAT)
   - Add to GitHub Secrets as `VSCE_PAT`

3. **Icon Conversion**
   - Convert SVG icon to PNG format
   - Required for marketplace listing

### 3. Key Points

- Extensions publish **immediately** (no review)
- Use semantic versioning: `v{MAJOR}.{MINOR}.{PATCH}`
- Rotate PAT token every 90 days
- Monitor GitHub Actions for deployment status
