// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

interface IPrngGenerator {
	// random number - if called twice in same block, will return same number
    function generateRandomNumber() external returns (uint256);

	// random number in range [lo, hi] - if called twice in same block with same seed == same answer
	function getPseudorandomNumber(uint256 lo, uint256 hi, uint256 userSeed) external returns (uint256);

	// array of random numbers in range [lo, hi] - salted to ensure potentially different answers
	function getPseudorandomNumberArray(uint256 lo, uint256 hi, uint256 userSeed, uint256 arrayLength) external returns (uint256[] memory);
}