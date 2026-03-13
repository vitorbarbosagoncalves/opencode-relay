/** @type {import('semantic-release').GlobalConfig} */
export default {
	branches: ["release"],
	plugins: [
		"@semantic-release/commit-analyzer",
		"@semantic-release/release-notes-generator",
		"@semantic-release/changelog",
		["@semantic-release/npm", { npmPublish: false }],
		[
			"@semantic-release/git",
			{
				assets: ["CHANGELOG.md", "package.json"],
				// biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release runtime template
				message:
					"chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
			},
		],
		"@semantic-release/github",
	],
};
