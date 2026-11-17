// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @title StatusList: a minimal on-chain credential status list.
/// @notice Every issuer owns one bitstring, keyed by its Ethereum address (the
///         controller address of its did:ethr). Bit `index` of the bitstring is
///         the status of the credential whose `credentialStatus.statusListIndex`
///         is `index`: 0 means valid, 1 means revoked.
///         Only the issuer can change its own bitstring, because the storage is
///         keyed by `msg.sender`. Anyone can read any bit.
/// @dev This is the on-chain counterpart of the W3C Bitstring Status List: the
///      bitstring is stored as 256-bit words instead of a compressed, encoded
///      list published at a URL.
contract StatusList {
    /// @dev issuer => word index => 256 status bits
    mapping(address => mapping(uint256 => uint256)) private words;

    /// @notice Emitted every time an issuer changes one of its bits.
    event StatusChanged(address indexed issuer, uint256 indexed index, bool value);

    /// @notice Sets bit `index` of the caller's bitstring to `value`.
    /// @param index the status list index of the credential
    /// @param value true to revoke, false to restore
    function setStatus(uint256 index, bool value) external {
        uint256 word = index >> 8;
        uint256 mask = uint256(1) << (index & 0xff);
        if (value) {
            words[msg.sender][word] |= mask;
        } else {
            words[msg.sender][word] &= ~mask;
        }
        emit StatusChanged(msg.sender, index, value);
    }

    /// @notice Returns bit `index` of `issuer`'s bitstring (true = revoked).
    function getStatus(address issuer, uint256 index) external view returns (bool) {
        return (words[issuer][index >> 8] >> (index & 0xff)) & 1 == 1;
    }

    /// @notice Returns the 256 bits of `issuer`'s bitstring starting at bit `word * 256`.
    function getWord(address issuer, uint256 word) external view returns (uint256) {
        return words[issuer][word];
    }
}
