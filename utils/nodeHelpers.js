function getArgFlag(arg) {
	const customIndex = process.argv.indexOf(`-${arg}`);

	if (customIndex > -1) {
		return true;
	}

	return false;
}

function getArg(arg) {
	const customidx = process.argv.indexOf(`-${arg}`);
	let customValue;

	if (customidx > -1) {
		// Retrieve the value after --custom
		customValue = process.argv[customidx + 1];
	}

	return customValue;
}

async function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function hex_to_ascii(hex) {
	const r = [];
	for (let i = 0; i < hex.length - 1; i += 2) {
		const v = parseInt(hex.charAt(i) + hex.charAt(i + 1), 16);
		if (v) r.push(String.fromCharCode(v));
	}
	return r.join('');
}

module.exports = { getArgFlag, getArg, sleep, hex_to_ascii };