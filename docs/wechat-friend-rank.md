# WeChat Friend Rank Runtime Contract

## Live path

The production friend-rank flow uses:

- `SubContextView`
- `wx.getOpenDataContext().postMessage(...)`
- `wx.setUserCloudStorage(...)`

Source locations:

- Main domain UI bridge: `assets/scripts/FriendRankView.ts`
- Main domain platform wrapper: `assets/scripts/WxGamePlatform.ts`
- Gameplay score sync: `assets/scripts/StackGame.ts`
- Open data template: `build-templates/wechatgame/openDataContext/index.js`

## Non-live path

`assets/scripts/CloudService.ts` and the cloud functions under `cloudfunctions/` are not part of the live gameplay leaderboard UI in the current build. They remain in the repo as an optional future global leaderboard solution.

## Build expectations

- WeChat friend rank remains the primary leaderboard product path.
- Open data context source files live under `build-templates/wechatgame/openDataContext/`.
- The project keeps remote main-bundle delivery enabled for the current release strategy.
- Do not wire `CloudService` into the gameplay UI unless the leaderboard product direction changes from friend-rank to global-rank.

## Runtime guarantees

- Repeated `show/hide/start/destroy` calls must not create duplicate friend-rank buttons, backdrops, close buttons, or resize listeners.
- WeChat lifecycle callbacks, share callbacks, and rewarded-ad callbacks must be registered and unregistered as matched pairs.
