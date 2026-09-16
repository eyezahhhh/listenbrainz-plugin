<h1>
    <img src="https://raw.githubusercontent.com/Pipe-Bomb/.github/refs/heads/master/assets/logos/Pipe%20Bomb%20no%20background%20w%20outline.png" width="40" />
    ListenBrainz Plugin
</h1>

Scrobbles to ListenBrainz and creates Pipe Bomb playlists for LB loved tracks and weekly recommendations.

## Installation

Clone the repo into your [Pipe Bomb server's](https://github.com/pipe-bomb/server) `plugins` directory. Then inside, run:

```bash
npm ci
npm run build
```

## Usage

Add your ListenBrainz username and user token in Pipe Bomb's per-user settings. Run the "Upload Scrobbles" task periodically (or use a workflow with a CRON!) to push your playback history to ListenBrainz. You can generate loved tracks and weekly recommendation playlists using the "Create Playlists" task.

## Contributing

The MiniSearch plugin is developed by [eyezah](https://github.com/eyezahhhh), but contributions are welcome!
