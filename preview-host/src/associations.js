import { ANDROID_PACKAGE_NAME, IOS_BUNDLE_ID } from './config.js';

// Android Digital Asset Links — https://developer.android.com/training/app-links/verify-android-applinks
export function buildAssetLinks(fingerprints) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

// Apple Universal Links association — scoped to /preview/* only.
// `apps` must be present (and empty) for applinks.
export function buildAppleAssociation(teamId) {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [`${teamId}.${IOS_BUNDLE_ID}`],
          components: [{ '/': '/preview/*' }],
        },
      ],
    },
  };
}
