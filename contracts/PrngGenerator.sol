// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.12 <0.9.0;

import { IPrngGenerator } from "./IPrngGenerator.sol";

contract PrngGenerator is IPrngGenerator {
    // Prng system contract address with ContractID 0.0.361
    address constant private PRECOMPILE_ADDRESS = address(0x169);

	uint256 constant private MAX_UINT256 = 2**256 - 1;

	enum RandomType {
        ANY,
        RANGE
    }

	event PrngEvent(RandomType method, address indexed caller, uint256 randomNumber, bytes32 seedBytes, uint256 lo, uint256 hi, uint256 userSeed, uint256 timestamp);

	error ParamsError(string message);

    function getPseudorandomSeed() external returns (bytes32 seedBytes) {
        (bool success, bytes memory result) = PRECOMPILE_ADDRESS.call(
            abi.encodeWithSelector(IPrngGenerator.getPseudorandomSeed.selector));
        require(success, "PRNG system call failed");
        seedBytes = abi.decode(result, (bytes32));
    }

	function generateRandomNumber() external returns (uint256) {
        bytes32 seedBytes = this.getPseudorandomSeed();
        uint256 randomNumber = uint256(seedBytes);

		emit PrngEvent(RandomType.ANY, msg.sender, randomNumber, seedBytes, 0, MAX_UINT256, 0, block.timestamp);
        return randomNumber;
    }

    /**
     * Returns a pseudorandom number in the range [lo, hi] using the seed generated from "getPseudorandomSeed"
     */
    function getPseudorandomNumber(uint256 lo, uint256 hi, uint256 userSeed)
        external
        returns (uint256 randNum)
    {
        if (lo >= hi) revert ParamsError("lo / hi");

        bytes32 seedBytes = this.getPseudorandomSeed();
        uint256 choice = bytesToUint(keccak256(abi.encodePacked(block.timestamp, seedBytes, userSeed, msg.sender)));

    	randNum = lo + (choice % (hi - lo));
		emit PrngEvent(RandomType.RANGE, msg.sender, randNum, seedBytes, lo, hi, userSeed, block.timestamp);
        return randNum;
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
			randNums[i] = this.getPseudorandomNumber(lo, hi, i + userSeed);
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