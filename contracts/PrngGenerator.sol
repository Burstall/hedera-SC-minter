// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

import "./PrngSystemContract.sol";

contract PrngGenerator is PrngSystemContract {

	event PrngEvent(address indexed caller, uint256 randomNumber, bytes32 seedBytes, uint256 high, uint256 low);

	error ParamsError(string message);

    function generateRandomNumber() public returns (uint256) {
        bytes32 seedBytes = this.getPseudorandomSeed();
        uint256 randomNumber = uint256(seedBytes);
        return randomNumber;
    }

    /**
     * Returns a pseudorandom number in the range [lo, hi] using the seed generated from "getPseudorandomSeed"
     */
    function getPseudorandomNumber(uint256 lo, uint256 hi, uint256 userSeed)
        public
        returns (uint256 randNum)
    {
        if (lo >= hi) revert ParamsError("lo / hi");

        bytes32 seedBytes = this.getPseudorandomSeed();
        uint256 choice = bytesToUint(keccak256(abi.encodePacked(block.timestamp, seedBytes, userSeed, msg.sender)));

    	randNum = lo + (choice % (hi - lo));

		emit PrngEvent(msg.sender, randNum, seedBytes, hi, lo);
    }

	/**
	 * Returns an array of pseudorandom numbers in the range [lo, hi] using the seed generated from "getPseudorandomSeed"
	 */
	function getPseudorandomNumberArray(uint256 lo, uint256 hi, uint256 userSeed, uint256 arrayLength) 
		external 
		returns (uint256[] memory randNums)
	{
		if (lo >= hi) revert ParamsError("lo / hi");
		if (arrayLength == 0) revert ParamsError("arrayLength == 0");

		randNums = new uint256[](arrayLength);
		for (uint256 i = 0; i < arrayLength; i++) {
			randNums[i] = getPseudorandomNumber(lo, hi, i + userSeed);
		}
	}

    function bytesToUint(bytes32 b) internal pure returns (uint256) {
        uint256 number;
        for (uint256 i = 0; i < b.length; i++) {
            number =
                number +
                uint256(uint8(b[i])) *
                (2**(8 * (b.length - (i + 1))));
        }
        return number;
    }
}
