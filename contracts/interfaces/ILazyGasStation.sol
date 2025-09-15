// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

interface ILazyGasStation {

	function refillLazy(uint256 _amount) external;

	function refillHbar(uint256 _amount) external;

	function drawLazyFrom(address _user, uint256 _amount, uint256 _burnPercentage) external;

	function drawLazyFromPayTo(address _user, uint256 _amount, uint256 _burnPercentage, address _payTo) external;

	function payoutLazy(address _user, uint256 _amount, uint256 _burnPercentage) external returns (uint256 _payoutAmount);

	function addAdmin(address _admin) external returns (bool _added);

	function removeAdmin(address _admin) external returns (bool _removed);

	function addAuthorizer(address _authorized) external returns (bool _added);

	function removeAuthorizer(address _authorized) external returns (bool _removed);

	function addContractUser(address _deployer) external returns (bool _added);

	function removeContractUser(address _deployer) external returns (bool _removed);

	function lazySCT() external returns (address _lazySCT);
}