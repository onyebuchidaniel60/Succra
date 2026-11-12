// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {EIP712} from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import {IERC1271} from '@openzeppelin/contracts/interfaces/IERC1271.sol';

/// @notice Local/testnet-only EIP-3009 token used to exercise Variant A and B.
/// @dev Mirrors the USDG/WIF ERC-3009 surface. For contract `from`, it calls
///      ERC-1271; for EOAs it uses ecrecover.
contract MockERC3009Token is ERC20, EIP712 {
    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
        );
    bytes4 private constant MAGIC = 0x1626ba7e;

    uint8 private immutable tokenDecimals;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) EIP712(name_, '1') {
        tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        require(block.timestamp >= validAfter, 'authorization not valid yet');
        require(block.timestamp < validBefore, 'authorization expired');
        require(!authorizationState[from][nonce], 'authorization already used');

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        if (from.code.length > 0) {
            require(
                IERC1271(from).isValidSignature(digest, signature) == MAGIC,
                'invalid contract signature'
            );
        } else {
            address recovered = ECDSA.recover(digest, signature);
            require(recovered == from, 'invalid signature');
        }

        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }
}
