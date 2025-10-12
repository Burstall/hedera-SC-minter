// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.12 <0.9.0;

interface IRoles {

	enum Role {
        Admin,
        Deployer,
		Mission,
		BoostManager,
		AdminOrCreator,
		Participant,
		GasStationContractUser,
		GasStationAuthorizer
    }

	error PermissionDenied(address _user, Role _role);

	error BadArgument();
}