// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

interface IBurnableHTS {
	function burn(address token, uint32 amount) external returns (int256 responseCode);
}